import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jest } from "@jest/globals";

import { RunDirectoryExistsError } from "../../src/commands/run/errors.js";
import { cleanupRunWorkspace } from "../../src/workspace/cleanup.js";
import { WorkspaceSetupError } from "../../src/workspace/errors.js";
import {
  removeRunDirectory,
  removeWorkspaceEntry,
} from "../../src/workspace/prune.js";
import { prepareRunWorkspace } from "../../src/workspace/run.js";

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
  it("creates a workspace and writes the prompt", async () => {
    const root = await createTempRoot("voratiq-run-");
    const { runWorkspace, prompt } = await prepareRunWorkspace({
      root,
      runId: "2025-11-10-test",
      prompt: "summarize spec",
    });

    expect(runWorkspace.absolute).toBe(
      join(root, ".voratiq", "runs", "sessions", "2025-11-10-test"),
    );
    const savedPrompt = await readFile(
      join(
        root,
        ".voratiq",
        "runs",
        "sessions",
        "2025-11-10-test",
        "prompt.txt",
      ),
      "utf8",
    );
    expect(savedPrompt).toBe(prompt);
  });

  it("throws when the run directory already exists", async () => {
    const root = await createTempRoot("voratiq-run-");
    const runDir = join(root, ".voratiq", "runs", "sessions", "existing-run");
    await fs.mkdir(runDir, { recursive: true });

    await expect(
      prepareRunWorkspace({
        root,
        runId: "existing-run",
        prompt: "noop",
      }),
    ).rejects.toThrow(RunDirectoryExistsError);
  });

  it("cleans up the workspace when writing the prompt fails", async () => {
    const root = await createTempRoot("voratiq-run-");
    const writeSpy = jest.mocked(fs.writeFile);
    writeSpy.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      prepareRunWorkspace({
        root,
        runId: "cleanup-run",
        prompt: "noop",
      }),
    ).rejects.toThrow("disk full");

    await expect(
      fs.access(join(root, ".voratiq", "runs", "sessions", "cleanup-run")),
    ).rejects.toThrow();
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
