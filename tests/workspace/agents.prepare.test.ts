import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import type { EnvironmentConfig } from "../../src/configs/environment/types.js";
import { createWorktree } from "../../src/utils/git.js";
import { prepareAgentWorkspace } from "../../src/workspace/agents.js";
import { ensureWorkspaceDependencies } from "../../src/workspace/dependencies.js";
import { buildAgentWorkspacePaths } from "../../src/workspace/layout.js";

jest.mock("../../src/utils/git.js", () => {
  const actual = jest.requireActual<typeof import("../../src/utils/git.js")>(
    "../../src/utils/git.js",
  );
  return {
    ...actual,
    createWorktree: jest.fn(),
  };
});

jest.mock("../../src/workspace/dependencies.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/workspace/dependencies.js")
  >("../../src/workspace/dependencies.js");
  return {
    ...actual,
    ensureWorkspaceDependencies: jest.fn(),
  };
});

const createWorktreeMock = jest.mocked(createWorktree);
const ensureWorkspaceDependenciesMock = jest.mocked(
  ensureWorkspaceDependencies,
);

describe("prepareAgentWorkspace", () => {
  let repoRoot: string;
  const environment: EnvironmentConfig = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    createWorktreeMock.mockResolvedValue(undefined);
    ensureWorkspaceDependenciesMock.mockResolvedValue(undefined);
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-prepare-workspace-"));
    const shimPath = join(
      repoRoot,
      "dist",
      "commands",
      "run",
      "shim",
      "run-agent-shim.mjs",
    );
    await mkdir(dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "console.log('shim');\n", "utf8");
  });

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
      repoRoot = "";
    }
  });

  it("links workspace dependencies after creating the worktree", async () => {
    const runId = "run-id";
    const agentId = "agent-id";
    const baseRevisionSha = "base-sha";
    const paths = buildAgentWorkspacePaths({ root: repoRoot, runId, agentId });

    await prepareAgentWorkspace({
      paths,
      baseRevisionSha,
      root: repoRoot,
      agentId,
      runId,
      environment,
    });

    expect(createWorktreeMock).toHaveBeenCalledTimes(1);
    expect(createWorktreeMock).toHaveBeenCalledWith({
      root: repoRoot,
      worktreePath: paths.workspacePath,
      branch: `voratiq/run/${runId}/${agentId}`,
      baseRevision: baseRevisionSha,
    });
    expect(ensureWorkspaceDependenciesMock).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceDependenciesMock).toHaveBeenCalledWith({
      root: repoRoot,
      workspacePath: paths.workspacePath,
      environment,
    });
    expect(
      ensureWorkspaceDependenciesMock.mock.invocationCallOrder[0],
    ).toBeGreaterThan(createWorktreeMock.mock.invocationCallOrder[0]);
  });
});
