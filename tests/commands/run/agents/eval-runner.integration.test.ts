import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { collectAgentArtifacts } from "../../../../src/commands/run/agents/artifacts.js";
import { runPostProcessingAndEvaluations } from "../../../../src/commands/run/agents/eval-runner.js";
import { buildRunAgentWorkspacePaths } from "../../../../src/commands/run/agents/workspace.js";
import { spawnStreamingProcess } from "../../../../src/utils/process.js";
import { buildAgentWorkspacePaths } from "../../../../src/workspace/layout.js";

jest.mock("../../../../src/commands/run/agents/artifacts.js", () => ({
  collectAgentArtifacts: jest.fn(),
}));

jest.mock("../../../../src/utils/process.js", () => ({
  spawnStreamingProcess: jest.fn(),
}));

const collectAgentArtifactsMock = jest.mocked(collectAgentArtifacts);
const spawnStreamingProcessMock = jest.mocked(spawnStreamingProcess);

const tempRoots: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  collectAgentArtifactsMock.mockResolvedValue({
    summaryCaptured: false,
    diffAttempted: false,
    diffCaptured: false,
  });
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runPostProcessingAndEvaluations integration", () => {
  it("recreates trusted sandbox tmp directories before eval spawn", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-eval-runner-int-"));
    tempRoots.push(root);

    const corePaths = buildAgentWorkspacePaths({
      root,
      runId: "run-1",
      agentId: "agent-1",
    });
    const workspacePaths = buildRunAgentWorkspacePaths({
      root,
      runId: "run-1",
      agentId: "agent-1",
      corePaths,
    });

    await mkdir(workspacePaths.workspacePath, { recursive: true });

    const sandboxTmpPath = join(workspacePaths.sandboxHomePath, "tmp");
    await expect(access(sandboxTmpPath)).rejects.toThrow();
    await expect(access(workspacePaths.sandboxHomePath)).rejects.toThrow();

    spawnStreamingProcessMock.mockImplementation(async () => {
      await expect(access(sandboxTmpPath)).resolves.toBeUndefined();
      await expect(
        access(workspacePaths.sandboxHomePath),
      ).resolves.toBeUndefined();
      return {
        exitCode: 0,
        signal: null,
      };
    });

    const result = await runPostProcessingAndEvaluations({
      evalPlan: [{ slug: "tests", command: "uv run pytest -q" }],
      workspacePaths,
      baseRevisionSha: "abc123",
      root,
      manifestEnv: {
        TMPDIR: sandboxTmpPath,
        TMP: sandboxTmpPath,
        TEMP: sandboxTmpPath,
        HOME: workspacePaths.sandboxHomePath,
      },
      environment: {
        python: { path: ".venv" },
      },
      persona: {
        authorName: "Sandbox",
        authorEmail: "sandbox@example.com",
      },
    });

    expect(spawnStreamingProcessMock).toHaveBeenCalledTimes(1);
    expect(result.evaluations).toEqual([
      expect.objectContaining({
        slug: "tests",
        status: "succeeded",
      }),
    ]);
  });
});
