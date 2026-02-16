import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { executeReviewCommand } from "../../../src/commands/review/command.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { loadAgentById } from "../../../src/configs/agents/loader.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { buildRunRecordView } from "../../../src/runs/records/enhanced.js";
import { fetchRunsSafely } from "../../../src/runs/records/persistence.js";

jest.mock("../../../src/competition/command-adapter.js", () => ({
  executeCompetitionWithAdapter: jest.fn(),
}));

jest.mock("../../../src/runs/records/persistence.js", () => ({
  fetchRunsSafely: jest.fn(),
}));

jest.mock("../../../src/runs/records/enhanced.js", () => ({
  buildRunRecordView: jest.fn(),
}));

jest.mock("../../../src/configs/agents/loader.js", () => ({
  loadAgentById: jest.fn(),
}));

jest.mock("../../../src/configs/environment/loader.js", () => ({
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock("../../../src/commands/shared/session-id.js", () => ({
  generateSessionId: jest.fn(),
}));

const fetchRunsSafelyMock = jest.mocked(fetchRunsSafely);
const buildRunRecordViewMock = jest.mocked(buildRunRecordView);
const loadAgentByIdMock = jest.mocked(loadAgentById);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const generateSessionIdMock = jest.mocked(generateSessionId);

describe("executeReviewCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes review execution through shared competition adapter with one competitor", async () => {
    fetchRunsSafelyMock.mockResolvedValue({
      records: [{ runId: "run-123" }],
    } as Awaited<ReturnType<typeof fetchRunsSafely>>);

    buildRunRecordViewMock.mockResolvedValue({
      runId: "run-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "succeeded",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      agents: [],
    });

    loadAgentByIdMock.mockReturnValue({
      id: "reviewer",
      provider: "codex",
      model: "gpt-5",
      binary: "node",
      argv: [],
    });
    loadEnvironmentConfigMock.mockReturnValue({});

    generateSessionIdMock.mockReturnValue("review-123");
    executeCompetitionWithAdapterMock.mockResolvedValue([
      {
        agentId: "reviewer",
        outputPath:
          ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        status: "succeeded",
        missingArtifacts: [],
      },
    ]);

    const result = await executeReviewCommand({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      reviewsFilePath: "/repo/.voratiq/reviews/index.json",
      runId: "run-123",
      agentId: "reviewer",
    });

    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [expect.objectContaining({ id: "reviewer" })],
        adapter: expect.any(Object),
      }),
    );
    expect(result).toMatchObject({
      reviewId: "review-123",
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
    });
  });
});
