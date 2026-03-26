import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { collectAgentArtifacts } from "../../../../src/domain/run/competition/agents/artifacts.js";
import { runPostProcessingAndCollectArtifacts } from "../../../../src/domain/run/competition/agents/post-processing.js";
import { buildRunAgentWorkspacePaths } from "../../../../src/domain/run/competition/agents/workspace.js";
import { buildAgentWorkspacePaths } from "../../../../src/workspace/layout.js";

jest.mock("../../../../src/domain/run/competition/agents/artifacts.js", () => ({
  collectAgentArtifacts: jest.fn(),
}));

const collectAgentArtifactsMock = jest.mocked(collectAgentArtifacts);

describe("runPostProcessingAndCollectArtifacts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns collected artifacts", async () => {
    collectAgentArtifactsMock.mockResolvedValue({
      summaryCaptured: true,
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 files changed",
    });

    const corePaths = buildAgentWorkspacePaths({
      root: "/repo",
      runId: "run-abc",
      agentId: "agent-x",
    });
    const workspacePaths = buildRunAgentWorkspacePaths({
      root: "/repo",
      runId: "run-abc",
      agentId: "agent-x",
      corePaths,
    });
    const persona = {
      authorName: "Sandbox Persona",
      authorEmail: "persona@example.com",
    };

    const result = await runPostProcessingAndCollectArtifacts({
      workspacePaths,
      baseRevisionSha: "abc123",
      root: "/repo",
      environment: {},
      persona,
    });

    expect(result.summaryCaptured).toBe(true);
    expect(collectAgentArtifactsMock).toHaveBeenCalledTimes(1);
    expect(collectAgentArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        persona,
        workspacePaths,
      }),
    );
  });
});
