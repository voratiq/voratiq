import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { executeReviewCommand } from "../../../src/commands/review/command.js";
import { ReviewPreflightError } from "../../../src/commands/review/errors.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
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

jest.mock("../../../src/configs/environment/loader.js", () => ({
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/commands/shared/session-id.js", () => ({
  generateSessionId: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

const fetchRunsSafelyMock = jest.mocked(fetchRunsSafely);
const buildRunRecordViewMock = jest.mocked(buildRunRecordView);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const generateSessionIdMock = jest.mocked(generateSessionId);
const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);

describe("executeReviewCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyAgentProvidersMock.mockResolvedValue([]);
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

    resolveStageCompetitorsMock.mockReturnValue({
      source: "cli",
      agentIds: ["reviewer"],
      competitors: [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
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
      agentIds: ["reviewer"],
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
    expect(result.reviews).toHaveLength(1);
  });

  it("clamps max-parallel to resolved reviewer count and preserves reviewer order", async () => {
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

    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["gamma", "alpha", "beta"],
      competitors: [
        {
          id: "gamma",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
        {
          id: "beta",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
    });
    loadEnvironmentConfigMock.mockReturnValue({});

    generateSessionIdMock.mockReturnValue("review-123");
    executeCompetitionWithAdapterMock.mockResolvedValue([
      {
        agentId: "gamma",
        outputPath:
          ".voratiq/reviews/sessions/review-123/gamma/artifacts/review.md",
        status: "succeeded",
        missingArtifacts: [],
      },
      {
        agentId: "alpha",
        outputPath:
          ".voratiq/reviews/sessions/review-123/alpha/artifacts/review.md",
        status: "succeeded",
        missingArtifacts: [],
      },
      {
        agentId: "beta",
        outputPath:
          ".voratiq/reviews/sessions/review-123/beta/artifacts/review.md",
        status: "succeeded",
        missingArtifacts: [],
      },
    ]);

    const result = await executeReviewCommand({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      reviewsFilePath: "/repo/.voratiq/reviews/index.json",
      runId: "run-123",
      maxParallel: 10,
    });

    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 3,
        candidates: [
          expect.objectContaining({ id: "gamma" }),
          expect.objectContaining({ id: "alpha" }),
          expect.objectContaining({ id: "beta" }),
        ],
      }),
    );
    expect(result.reviews.map((review) => review.agentId)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("fails preflight before execution when any reviewer provider/auth check fails", async () => {
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

    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["reviewer-a", "reviewer-b"],
      competitors: [
        {
          id: "reviewer-a",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
        {
          id: "reviewer-b",
          provider: "claude",
          model: "claude-sonnet",
          binary: "node",
          argv: [],
        },
      ],
    });
    verifyAgentProvidersMock.mockResolvedValue([
      { agentId: "reviewer-a", message: "token expired" },
      { agentId: "reviewer-b", message: "missing provider" },
    ]);

    let caught: unknown;
    try {
      await executeReviewCommand({
        root: "/repo",
        runsFilePath: "/repo/.voratiq/runs/index.json",
        reviewsFilePath: "/repo/.voratiq/reviews/index.json",
        runId: "run-123",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ReviewPreflightError);
    const preflight = caught as ReviewPreflightError;
    expect(preflight.headline).toBe("Preflight failed. Aborting review.");
    expect(preflight.detailLines).toEqual(
      expect.arrayContaining([
        "- reviewer-a: token expired",
        "- reviewer-b: missing provider",
      ]),
    );
    expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
  });
});
