import { execFile } from "node:child_process";

import { fs, vol } from "memfs";

import { executeInitCommand } from "../../src/commands/init/command.js";
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
import { WorkspaceMissingEntryError } from "../../src/workspace/errors.js";
import { WorkspaceNotInitializedError } from "../../src/workspace/errors.js";
import { WorkspaceSetupError } from "../../src/workspace/errors.js";
import { WorkspaceWrongTypeEntryError } from "../../src/workspace/errors.js";
import * as workspaceSetup from "../../src/workspace/setup.js";

jest.mock("node:fs/promises", () => fs.promises);
jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));
jest.mock("../../src/commands/init/command.js", () => ({
  executeInitCommand: jest.fn(),
}));
const execFileMock = jest.mocked(execFile);
const executeInitCommandMock = jest.mocked(executeInitCommand);

function buildValidWorkspaceTree(
  root = "/app/voratiq",
): Record<string, null | string> {
  return {
    [`${root}/.git`]: "",
    [`${root}/.voratiq`]: null,
    [`${root}/.voratiq/runs`]: null,
    [`${root}/.voratiq/runs/sessions`]: null,
    [`${root}/.voratiq/runs/index.json`]: '{"version":2,"sessions":[]}\n',
    [`${root}/.voratiq/reductions`]: null,
    [`${root}/.voratiq/reductions/sessions`]: null,
    [`${root}/.voratiq/reductions/index.json`]: '{"version":1,"sessions":[]}\n',
    [`${root}/.voratiq/reviews`]: null,
    [`${root}/.voratiq/reviews/sessions`]: null,
    [`${root}/.voratiq/reviews/index.json`]: '{"version":1,"sessions":[]}\n',
    [`${root}/.voratiq/specs`]: null,
    [`${root}/.voratiq/specs/sessions`]: null,
    [`${root}/.voratiq/specs/index.json`]: '{"version":1,"sessions":[]}\n',
    [`${root}/.voratiq/agents.yaml`]: "agents: []\n",
    [`${root}/.voratiq/evals.yaml`]: "\n",
    [`${root}/.voratiq/environment.yaml`]: "\n",
    [`${root}/.voratiq/sandbox.yaml`]: "providers: {}\n",
    [`${root}/.voratiq/orchestration.yaml`]:
      "profiles:\n  default:\n    spec:\n      agents: []\n    run:\n      agents: []\n    review:\n      agents: []\n",
  };
}

describe("CLI Context", () => {
  beforeEach(() => {
    vol.reset();
    jest.spyOn(process, "cwd").mockReturnValue("/app/voratiq");
    executeInitCommandMock.mockReset();
    executeInitCommandMock.mockImplementation(async ({ root }) => {
      await fs.promises.mkdir(`${root}/.voratiq/runs/sessions`, {
        recursive: true,
      });
      await fs.promises.mkdir(`${root}/.voratiq/reductions/sessions`, {
        recursive: true,
      });
      await fs.promises.mkdir(`${root}/.voratiq/reviews/sessions`, {
        recursive: true,
      });
      await fs.promises.mkdir(`${root}/.voratiq/specs/sessions`, {
        recursive: true,
      });

      await fs.promises.writeFile(
        `${root}/.voratiq/runs/index.json`,
        '{"version":2,"sessions":[]}\n',
      );
      await fs.promises.writeFile(
        `${root}/.voratiq/reductions/index.json`,
        '{"version":1,"sessions":[]}\n',
      );
      await fs.promises.writeFile(
        `${root}/.voratiq/reviews/index.json`,
        '{"version":1,"sessions":[]}\n',
      );
      await fs.promises.writeFile(
        `${root}/.voratiq/specs/index.json`,
        '{"version":1,"sessions":[]}\n',
      );
      await fs.promises.writeFile(
        `${root}/.voratiq/agents.yaml`,
        "agents: []\n",
      );
      await fs.promises.writeFile(`${root}/.voratiq/evals.yaml`, "\n");
      await fs.promises.writeFile(`${root}/.voratiq/environment.yaml`, "\n");
      await fs.promises.writeFile(
        `${root}/.voratiq/sandbox.yaml`,
        "providers: {}\n",
      );
      await fs.promises.writeFile(
        `${root}/.voratiq/orchestration.yaml`,
        "profiles:\n  default:\n    spec:\n      agents: []\n    run:\n      agents: []\n    review:\n      agents: []\n",
      );

      return {
        preset: "pro",
        workspaceResult: { createdDirectories: [], createdFiles: [] },
        agentSummary: {
          configPath: ".voratiq/agents.yaml",
          enabledAgents: [],
          agentCount: 0,
          zeroDetections: true,
          detectedProviders: [],
          providerEnablementPrompted: false,
          configCreated: true,
          configUpdated: true,
        },
        orchestrationSummary: {
          configPath: ".voratiq/orchestration.yaml",
          configCreated: true,
        },
        environmentSummary: {
          configPath: ".voratiq/environment.yaml",
          detectedEntries: [],
          configCreated: true,
          configUpdated: true,
          config: {},
        },
        evalSummary: {
          configPath: ".voratiq/evals.yaml",
          configuredEvals: [],
          configCreated: true,
          configUpdated: true,
        },
        sandboxSummary: {
          configPath: ".voratiq/sandbox.yaml",
          configCreated: true,
        },
      };
    });
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
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("should not throw an error if workspace is not required and not found", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
      });
      const context: CliContext = await resolveCliContext({
        requireWorkspace: false,
      });
      expect(context.root).toBe("/app/voratiq");
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("auto-initializes for forward workflows when workspace is fully missing", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
      });

      const context: CliContext = await resolveCliContext({
        workspaceAutoInitMode: "when-missing",
      });

      expect(context.root).toBe("/app/voratiq");
      expect(context.workspaceAutoInitialized).toBe(true);
      expect(executeInitCommandMock).toHaveBeenCalledTimes(1);
      expect(executeInitCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          root: "/app/voratiq",
          preset: "pro",
          interactive: false,
          assumeYes: true,
        }),
      );
    });

    it("does not auto-initialize when workspace is partial or invalid", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
        "/app/voratiq/.voratiq/agents.yaml": "",
        "/app/voratiq/.voratiq": null,
      });

      await expect(
        resolveCliContext({
          workspaceAutoInitMode: "when-missing",
        }),
      ).rejects.toThrow(WorkspaceMissingEntryError);

      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("repairs a legacy workspace missing one domain directory", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/reductions", {
        recursive: true,
        force: true,
      });

      const context = await resolveCliContext();

      expect(context.workspaceAutoRepaired).toBe(true);
      await expect(
        fs.promises.access("/app/voratiq/.voratiq/reductions"),
      ).resolves.toBeUndefined();
      await expect(
        fs.promises.access("/app/voratiq/.voratiq/reductions/sessions"),
      ).resolves.toBeUndefined();
      await expect(
        fs.promises.readFile("/app/voratiq/.voratiq/reductions/index.json", {
          encoding: "utf8",
        }),
      ).resolves.toContain('"version": 1');
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("repairs a legacy workspace missing one domain index file", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/reviews/index.json", {
        force: true,
      });

      const context = await resolveCliContext();

      expect(context.workspaceAutoRepaired).toBe(true);
      await expect(
        fs.promises.readFile("/app/voratiq/.voratiq/reviews/index.json", {
          encoding: "utf8",
        }),
      ).resolves.toContain('"version": 1');
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("repairs a legacy workspace missing one domain sessions directory", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/specs/sessions", {
        recursive: true,
        force: true,
      });

      const context = await resolveCliContext();

      expect(context.workspaceAutoRepaired).toBe(true);
      await expect(
        fs.promises.access("/app/voratiq/.voratiq/specs/sessions"),
      ).resolves.toBeUndefined();
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("repairs multiple missing domain storage entries in one pass", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/reviews", {
        recursive: true,
        force: true,
      });
      await fs.promises.rm("/app/voratiq/.voratiq/specs/index.json", {
        force: true,
      });
      await fs.promises.rm("/app/voratiq/.voratiq/runs/sessions", {
        recursive: true,
        force: true,
      });

      const context = await resolveCliContext();

      expect(context.workspaceAutoRepaired).toBe(true);
      await expect(
        fs.promises.access("/app/voratiq/.voratiq/reviews/sessions"),
      ).resolves.toBeUndefined();
      await expect(
        fs.promises.readFile("/app/voratiq/.voratiq/specs/index.json", "utf8"),
      ).resolves.toContain('"version": 1');
      await expect(
        fs.promises.access("/app/voratiq/.voratiq/runs/sessions"),
      ).resolves.toBeUndefined();
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("fails when a required path exists with the wrong type", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/reductions", {
        recursive: true,
        force: true,
      });
      await fs.promises.writeFile("/app/voratiq/.voratiq/reductions", "");

      await expect(resolveCliContext()).rejects.toThrow(
        WorkspaceWrongTypeEntryError,
      );
      await expect(resolveCliContext()).rejects.toThrow(
        "Wrong workspace entry type: `.voratiq/reductions` must be a directory.",
      );
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it.each([
      ["/app/voratiq/.voratiq/runs/index.json", ".voratiq/runs/index.json"],
      [
        "/app/voratiq/.voratiq/reviews/index.json",
        ".voratiq/reviews/index.json",
      ],
      ["/app/voratiq/.voratiq/specs/index.json", ".voratiq/specs/index.json"],
      [
        "/app/voratiq/.voratiq/reductions/index.json",
        ".voratiq/reductions/index.json",
      ],
    ])(
      "fails preflight when %s is malformed even with no missing entries",
      async (indexPath, displayPath) => {
        vol.fromJSON(buildValidWorkspaceTree());
        await fs.promises.writeFile(indexPath, '{"version":2,');

        await expect(resolveCliContext()).rejects.toThrow(WorkspaceSetupError);
        await expect(resolveCliContext()).rejects.toThrow(
          `Failed to parse workspace index \`${displayPath}\`:`,
        );
      },
    );

    it("fails when an existing index is malformed instead of overwriting it during repair", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.writeFile(
        "/app/voratiq/.voratiq/runs/index.json",
        '{"version":2,',
      );
      await fs.promises.rm("/app/voratiq/.voratiq/reductions/sessions", {
        recursive: true,
        force: true,
      });

      await expect(resolveCliContext()).rejects.toThrow(WorkspaceSetupError);
      await expect(resolveCliContext()).rejects.toThrow(
        "Failed to parse workspace index `.voratiq/runs/index.json`:",
      );
    });

    it("fails when a required sessions directory path exists as a file", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/specs/sessions", {
        recursive: true,
        force: true,
      });
      await fs.promises.writeFile("/app/voratiq/.voratiq/specs/sessions", "");

      await expect(resolveCliContext()).rejects.toThrow(
        WorkspaceWrongTypeEntryError,
      );
      await expect(resolveCliContext()).rejects.toThrow(
        "Wrong workspace entry type: `.voratiq/specs/sessions` must be a directory.",
      );
    });

    it("fails when a required index path exists as a directory", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/reviews/index.json", {
        force: true,
      });
      await fs.promises.mkdir("/app/voratiq/.voratiq/reviews/index.json");

      await expect(resolveCliContext()).rejects.toThrow(
        WorkspaceWrongTypeEntryError,
      );
      await expect(resolveCliContext()).rejects.toThrow(
        "Wrong workspace entry type: `.voratiq/reviews/index.json` must be a file.",
      );
    });

    it("fails when a required config path exists as a directory", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/evals.yaml", {
        force: true,
      });
      await fs.promises.mkdir("/app/voratiq/.voratiq/evals.yaml");

      await expect(resolveCliContext()).rejects.toThrow(
        WorkspaceWrongTypeEntryError,
      );
      await expect(resolveCliContext()).rejects.toThrow(
        "Wrong workspace entry type: `.voratiq/evals.yaml` must be a file.",
      );
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("fails when a required config file is missing", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      await fs.promises.rm("/app/voratiq/.voratiq/evals.yaml", {
        force: true,
      });

      await expect(resolveCliContext()).rejects.toThrow(
        WorkspaceMissingEntryError,
      );
      expect(executeInitCommandMock).not.toHaveBeenCalled();
    });

    it("runs preflight in deterministic order: git check, init decision, validation", async () => {
      vol.fromJSON({
        "/app/voratiq/.git": "",
      });
      const assertGitSpy = jest
        .spyOn(git, "assertGitRepository")
        .mockResolvedValue(undefined);
      const validateWorkspaceSpy = jest.spyOn(
        workspaceSetup,
        "validateWorkspace",
      );

      let gitCallOrder = -1;
      let initCallOrder = -1;
      let validateCallOrder = -1;

      try {
        await resolveCliContext({
          workspaceAutoInitMode: "when-missing",
        });
        gitCallOrder = assertGitSpy.mock.invocationCallOrder[0] ?? -1;
        initCallOrder =
          executeInitCommandMock.mock.invocationCallOrder[0] ?? -1;
        validateCallOrder =
          validateWorkspaceSpy.mock.invocationCallOrder[0] ?? -1;
      } finally {
        assertGitSpy.mockRestore();
        validateWorkspaceSpy.mockRestore();
      }

      expect(typeof gitCallOrder).toBe("number");
      expect(typeof initCallOrder).toBe("number");
      expect(typeof validateCallOrder).toBe("number");
      expect(gitCallOrder).toBeLessThan(initCallOrder);
      expect(initCallOrder).toBeLessThan(validateCallOrder);
    });

    it("should return the CLI context if workspace is valid", async () => {
      vol.fromJSON(buildValidWorkspaceTree());
      const context: CliContext = await resolveCliContext();
      expect(context.root).toBe("/app/voratiq");
      expect(context.workspacePaths.workspaceDir).toBe("/app/voratiq/.voratiq");
      expect(context.workspaceAutoRepaired).toBe(false);
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
