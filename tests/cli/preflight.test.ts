import { execFile } from "node:child_process";

import { fs, vol } from "memfs";

import {
  DirtyWorkingTreeError,
  SpecNotFoundError,
} from "../../src/preflight/errors.js";
import {
  CliContext,
  ensureCleanWorkingTree,
  ensureSpecPath,
  resolveCliContext,
  ResolvedSpecPath,
} from "../../src/preflight/index.js";
import { GitRepositoryError } from "../../src/utils/errors.js";
import * as git from "../../src/utils/git.js";
import { WorkspaceNotInitializedError } from "../../src/workspace/errors.js";

jest.mock("node:fs/promises", () => fs.promises);
jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));
const execFileMock = jest.mocked(execFile);

describe("CLI Context", () => {
  beforeEach(() => {
    vol.reset();
    jest.spyOn(process, "cwd").mockReturnValue("/app/voratiq");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("resolveCliContext", () => {
    it("should throw with no-repo message when no git repository exists", async () => {
      vol.fromJSON({
        "/app/voratiq/some-file": "",
      });
      // Mock git rev-parse to fail (no repo found)
      execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = callback as (error: Error | null, result: unknown) => void;
        cb(new Error("fatal: not a git repository"), null);
        return {} as ReturnType<typeof execFile>;
      });

      await expect(resolveCliContext()).rejects.toThrow(GitRepositoryError);
      await expect(resolveCliContext()).rejects.toThrow(
        "No git repository found. Run `git init` or switch to an existing repository.",
      );
    });

    it("should throw with not-at-root message when inside a git repo but not at root", async () => {
      vol.fromJSON({
        "/app/voratiq/subdir/some-file": "",
      });
      jest.spyOn(process, "cwd").mockReturnValue("/app/voratiq/subdir");
      // Mock git rev-parse to succeed (inside a repo)
      execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = callback as (error: Error | null, result: unknown) => void;
        cb(null, { stdout: "/app/voratiq\n" });
        return {} as ReturnType<typeof execFile>;
      });

      await expect(resolveCliContext()).rejects.toThrow(GitRepositoryError);
      await expect(resolveCliContext()).rejects.toThrow(
        "Run `voratiq init` from the repository root.",
      );
    });

    it("should throw an error if workspace is required and not found", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
      });
      await expect(resolveCliContext()).rejects.toThrow(
        WorkspaceNotInitializedError,
      );
    });

    it("should not throw an error if workspace is not required and not found", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
      });
      const context: CliContext = await resolveCliContext({
        requireWorkspace: false,
      });
      expect(context.root).toBe("/app/voratiq");
    });

    it("should return the CLI context if workspace is valid", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
        "/app/voratiq/.voratiq/runs/index.json": "",
        "/app/voratiq/.voratiq/runs": null,
        "/app/voratiq/.voratiq/agents.yaml": "",
        "/app/voratiq/.voratiq/evals.yaml": "",
        "/app/voratiq/.voratiq/environment.yaml": "",
        "/app/voratiq/.voratiq/sandbox.yaml": "",
      });
      const context: CliContext = await resolveCliContext();
      expect(context.root).toBe("/app/voratiq");
      expect(context.workspacePaths.workspaceDir).toBe("/app/voratiq/.voratiq");
    });
  });

  describe("ensureSpecPath", () => {
    beforeEach(() => {
      vol.fromJSON({
        "/app/voratiq/spec.md": "test spec",
      });
    });

    it("should return the resolved spec path if it exists", async () => {
      const specPath: ResolvedSpecPath = await ensureSpecPath(
        "spec.md",
        "/app/voratiq",
      );
      expect(specPath.absolutePath).toBe("/app/voratiq/spec.md");
      expect(specPath.displayPath).toBe("spec.md");
    });

    it("should throw an error if the spec path does not exist", async () => {
      await expect(
        ensureSpecPath("nonexistent.md", "/app/voratiq"),
      ).rejects.toThrow(SpecNotFoundError);
    });
  });

  describe("ensureCleanWorkingTree", () => {
    it("resolves when git status is empty", async () => {
      const spy = jest.spyOn(git, "runGitCommand").mockResolvedValue("");

      await expect(ensureCleanWorkingTree("/app/voratiq")).resolves.toEqual({
        cleanWorkingTree: true,
      });
      expect(spy).toHaveBeenCalledWith(
        ["status", "--porcelain=v1", "--untracked-files=no"],
        { cwd: "/app/voratiq" },
      );
    });

    it("throws a DirtyWorkingTreeError with formatted paths", async () => {
      jest
        .spyOn(git, "runGitCommand")
        .mockResolvedValue(" M src/api/client.ts\nM README.md\n");

      let capturedError: unknown;
      await expect(
        ensureCleanWorkingTree("/app/voratiq").catch((error) => {
          capturedError = error;
          throw error;
        }),
      ).rejects.toThrow(DirtyWorkingTreeError);

      expect(capturedError).toBeInstanceOf(DirtyWorkingTreeError);
      const dirtyError = capturedError as DirtyWorkingTreeError;
      expect(dirtyError.message).toBe(
        "Repository has uncommitted tracked changes.",
      );
      expect(dirtyError.detailLines).toEqual([
        "Dirty paths:",
        "  - src/api/client.ts (modified)",
        "  - README.md (staged)",
      ]);
      expect(dirtyError.hintLines).toEqual([
        "Stash or commit local changes before continuing.",
      ]);
    });

    it("limits the dirty path listing to three entries", async () => {
      jest
        .spyOn(git, "runGitCommand")
        .mockResolvedValue(
          [
            " M src/file1.ts",
            "M  src/file2.ts",
            " M src/file3.ts",
            " M src/file4.ts",
          ].join("\n"),
        );

      let capturedError: unknown;
      await expect(
        ensureCleanWorkingTree("/app/voratiq").catch((error) => {
          capturedError = error;
          throw error;
        }),
      ).rejects.toThrow(DirtyWorkingTreeError);

      expect(capturedError).toBeInstanceOf(DirtyWorkingTreeError);
      const dirtyError = capturedError as DirtyWorkingTreeError;
      expect(dirtyError.message).toBe(
        "Repository has uncommitted tracked changes.",
      );
      expect(dirtyError.detailLines).toEqual([
        "Dirty paths:",
        "  - src/file1.ts (modified)",
        "  - src/file2.ts (staged)",
        "  - src/file3.ts (modified)",
        "  - (and 1 more path)",
      ]);
      expect(dirtyError.hintLines).toEqual([
        "Stash or commit local changes before continuing.",
      ]);
    });
  });
});
