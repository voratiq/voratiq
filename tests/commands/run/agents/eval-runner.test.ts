import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { runPostProcessingAndEvaluations } from "../../../../src/commands/run/agents/eval-runner.js";
import { executeEvaluations } from "../../../../src/evals/runner.js";
import { collectAgentArtifacts } from "../../../../src/workspace/agents.js";
import { buildAgentWorkspacePaths } from "../../../../src/workspace/layout.js";

jest.mock("../../../../src/workspace/agents.js", () => ({
  collectAgentArtifacts: jest.fn(),
}));

jest.mock("../../../../src/evals/runner.js", () => ({
  executeEvaluations: jest.fn(),
}));

const collectAgentArtifactsMock = jest.mocked(collectAgentArtifacts);
const executeEvaluationsMock = jest.mocked(executeEvaluations);

describe("runPostProcessingAndEvaluations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns artifacts, evaluation results, and warnings", async () => {
    collectAgentArtifactsMock.mockResolvedValue({
      summaryCaptured: true,
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 files changed",
    });
    executeEvaluationsMock.mockResolvedValue({
      results: [
        { slug: "lint", status: "succeeded" },
        { slug: "tests", status: "failed", error: "1 failing test" },
      ],
      warnings: ["lint logs unavailable"],
    });

    const workspacePaths = buildAgentWorkspacePaths({
      root: "/repo",
      runId: "run-abc",
      agentId: "agent-x",
    });
    const persona = {
      authorName: "Sandbox Persona",
      authorEmail: "persona@example.com",
    };

    const result = await runPostProcessingAndEvaluations({
      evalPlan: [{ slug: "lint" }],
      workspacePaths,
      baseRevisionSha: "abc123",
      root: "/repo",
      manifestEnv: { PATH: "/bin" },
      environment: {},
      persona,
    });

    expect(result.artifacts.summaryCaptured).toBe(true);
    expect(result.evaluations).toHaveLength(2);
    expect(result.warnings).toEqual(["lint logs unavailable"]);
    expect(collectAgentArtifactsMock).toHaveBeenCalledTimes(1);
    expect(collectAgentArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({ persona }),
    );
    expect(executeEvaluationsMock).toHaveBeenCalledTimes(1);
  });
});
