import * as fs from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jest } from "@jest/globals";

import { RunDirectoryExistsError } from "../../src/domain/run/competition/errors.js";
import {
  cleanupRunWorkspace,
  removeRunDirectory,
  removeWorkspaceEntry,
} from "../../src/workspace/cleanup.js";
import { WorkspaceSetupError } from "../../src/workspace/errors.js";
import {
  prepareRunWorkspace,
  stageExternalSpecCopy,
} from "../../src/workspace/run.js";

jest.mock("node:fs/promises", () => {
  const actual =
    jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    __esModule: true,
    ...actual,
    writeFile: jest.fn(actual.writeFile),
    rm: jest.fn(actual.rm),
  };
});

const tempRoots: string[] = [];

async function createTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("prepareRunWorkspace", () => {
  it("creates a workspace directory without persisting a prompt file", async () => {
    const root = await createTempRoot("voratiq-run-");
    const { runWorkspace } = await prepareRunWorkspace({
      root,
      runId: "2025-11-10-test",
    });

    expect(runWorkspace.absolute).toBe(
      join(root, ".voratiq", "run", "sessions", "2025-11-10-test"),
    );
    await expect(
      fs.access(
        join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "2025-11-10-test",
          "prompt.txt",
        ),
      ),
    ).rejects.toThrow();
  });

  it("throws when the run directory already exists", async () => {
    const root = await createTempRoot("voratiq-run-");
    const runDir = join(root, ".voratiq", "run", "sessions", "existing-run");
    await fs.mkdir(runDir, { recursive: true });

    await expect(
      prepareRunWorkspace({
        root,
        runId: "existing-run",
      }),
    ).rejects.toThrow(RunDirectoryExistsError);
  });

  it("copies external specs into the retained spec directory", async () => {
    const root = await createTempRoot("voratiq-run-");
    const externalRoot = await createTempRoot("voratiq-external-spec-");
    const sourceSpecPath = join(externalRoot, "external-spec.md");
    await writeFile(sourceSpecPath, "# External Spec\n", "utf8");

    const staged = await stageExternalSpecCopy({
      root,
      sourceAbsolutePath: sourceSpecPath,
    });

    expect(staged.relativePath).toBe(".voratiq/spec/external-spec.md");
    await expect(fs.readFile(staged.absolutePath, "utf8")).resolves.toBe(
      "# External Spec\n",
    );
  });

  it("appends numeric suffixes when retained external spec basenames collide", async () => {
    const root = await createTempRoot("voratiq-run-");
    const externalRoot = await createTempRoot("voratiq-external-spec-");
    const firstSpecPath = join(externalRoot, "hello-world.md");
    const secondSpecDir = join(externalRoot, "nested");
    const secondSpecPath = join(secondSpecDir, "hello-world.md");
    await fs.mkdir(secondSpecDir, { recursive: true });
    await writeFile(firstSpecPath, "# First\n", "utf8");
    await writeFile(secondSpecPath, "# Second\n", "utf8");

    const first = await stageExternalSpecCopy({
      root,
      sourceAbsolutePath: firstSpecPath,
    });
    const second = await stageExternalSpecCopy({
      root,
      sourceAbsolutePath: secondSpecPath,
    });

    expect(first.relativePath).toBe(".voratiq/spec/hello-world.md");
    expect(second.relativePath).toBe(".voratiq/spec/hello-world-2.md");
    await expect(fs.readFile(first.absolutePath, "utf8")).resolves.toBe(
      "# First\n",
    );
    await expect(fs.readFile(second.absolutePath, "utf8")).resolves.toBe(
      "# Second\n",
    );
  });
});

describe("removeWorkspaceEntry and removeRunDirectory", () => {
  it("removes existing paths", async () => {
    const root = await createTempRoot("voratiq-prune-");
    const workspacePath = join(root, "temp", "workspace");
    await fs.mkdir(workspacePath, { recursive: true });
    const filePath = join(workspacePath, "artifact.log");
    await writeFile(filePath, "log", "utf8");

    await removeWorkspaceEntry({ path: filePath, root });
    await removeRunDirectory(workspacePath, root);

    await expect(fs.access(workspacePath)).rejects.toThrow();
  });

  it("wraps filesystem errors", async () => {
    const root = await createTempRoot("voratiq-prune-");
    const target = join(root, "temp", "artifact.log");
    await fs.mkdir(join(root, "temp"), { recursive: true });
    const rmSpy = jest.mocked(fs.rm);
    rmSpy.mockRejectedValueOnce(new Error("permission denied"));

    await expect(removeWorkspaceEntry({ path: target, root })).rejects.toThrow(
      WorkspaceSetupError,
    );
  });
});

describe("cleanupRunWorkspace", () => {
  it("swallows errors while attempting to remove directories", async () => {
    const rmSpy = jest.mocked(fs.rm);
    rmSpy.mockRejectedValueOnce(new Error("busy"));

    await expect(
      cleanupRunWorkspace("/tmp/non-existent"),
    ).resolves.toBeUndefined();
  });
});

afterEach(async () => {
  const roots = tempRoots.splice(0, tempRoots.length);
  await Promise.all(
    roots.map((root) =>
      rm(root, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});
