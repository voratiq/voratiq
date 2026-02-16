import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceMissingEntryError } from "../../src/workspace/errors.js";
import {
  createWorkspace,
  validateWorkspace,
} from "../../src/workspace/setup.js";
import { resolveWorkspacePath } from "../../src/workspace/structure.js";
import type { CreateWorkspaceResult } from "../../src/workspace/types.js";

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "voratiq-init-"));
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

function normalizeForAssertion(value: string): string {
  return value.replace(/\\/g, "/");
}

describe("workspace bootstrap", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await createTempRepo();
  });

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates minimal workspace and validates", async () => {
    const result: CreateWorkspaceResult = await createWorkspace(repoRoot);

    const createdDirs = result.createdDirectories.map((dir) =>
      normalizeForAssertion(dir),
    );
    const createdFiles = result.createdFiles.map((file) =>
      normalizeForAssertion(file),
    );

    expect(createdDirs).toEqual(
      expect.arrayContaining([
        normalizeForAssertion(".voratiq"),
        normalizeForAssertion(join(".voratiq", "runs")),
        normalizeForAssertion(join(".voratiq", "runs", "sessions")),
      ]),
    );
    expect(createdFiles).toEqual(
      expect.arrayContaining([
        normalizeForAssertion(join(".voratiq", "runs", "index.json")),
        normalizeForAssertion(join(".voratiq", "agents.yaml")),
        normalizeForAssertion(join(".voratiq", "evals.yaml")),
        normalizeForAssertion(join(".voratiq", "environment.yaml")),
        normalizeForAssertion(join(".voratiq", "sandbox.yaml")),
        normalizeForAssertion(join(".voratiq", "orchestration.yaml")),
      ]),
    );

    await expect(validateWorkspace(repoRoot)).resolves.toBeUndefined();
  });

  it("fails validation when the run index is missing", async () => {
    await createWorkspace(repoRoot);
    const runsPath = resolveWorkspacePath(repoRoot, "runs", "index.json");
    await rm(runsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when agents.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const agentsPath = resolveWorkspacePath(repoRoot, "agents.yaml");
    await rm(agentsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when evals.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const evalsPath = resolveWorkspacePath(repoRoot, "evals.yaml");
    await rm(evalsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when environment.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const environmentPath = resolveWorkspacePath(repoRoot, "environment.yaml");
    await rm(environmentPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when sandbox.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const sandboxPath = resolveWorkspacePath(repoRoot, "sandbox.yaml");
    await rm(sandboxPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when orchestration.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const orchestrationPath = resolveWorkspacePath(
      repoRoot,
      "orchestration.yaml",
    );
    await rm(orchestrationPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });
});
