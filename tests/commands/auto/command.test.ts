import { jest } from "@jest/globals";

import {
  type AutoApplyStageResult,
  type AutoCommandDependencies,
  type AutoReviewStageResult,
  type AutoRunStageResult,
  executeAutoCommand,
  type ReviewerRecommendation,
} from "../../../src/commands/auto/command.js";

function createDependencies(
  overrides: Partial<AutoCommandDependencies> = {},
): AutoCommandDependencies {
  const runSpecStage: jest.MockedFunction<
    AutoCommandDependencies["runSpecStage"]
  > = jest.fn();
  const runRunStage: jest.MockedFunction<
    AutoCommandDependencies["runRunStage"]
  > = jest.fn();
  const runReviewStage: jest.MockedFunction<
    AutoCommandDependencies["runReviewStage"]
  > = jest.fn();
  const runApplyStage: jest.MockedFunction<
    AutoCommandDependencies["runApplyStage"]
  > = jest.fn();
  const loadRecommendation: jest.MockedFunction<
    AutoCommandDependencies["loadRecommendation"]
  > = jest.fn();
  const loadReviewerRecommendations: jest.MockedFunction<
    AutoCommandDependencies["loadReviewerRecommendations"]
  > = jest.fn();

  return {
    runSpecStage,
    runRunStage,
    runReviewStage,
    runApplyStage,
    loadRecommendation,
    loadReviewerRecommendations,
    ...overrides,
  };
}

function createRunStageResult(
  overrides: Partial<AutoRunStageResult> = {},
): AutoRunStageResult {
  return {
    body: "run body",
    report: {
      runId: "run-1",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      baseRevisionSha: "deadbeef",
      spec: { path: "specs/task.md" },
      agents: [{ agentId: "alpha" }, { agentId: "beta" }],
    },
    ...overrides,
  };
}

function createReviewStageResult(
  overrides: Partial<AutoReviewStageResult> = {},
): AutoReviewStageResult {
  return {
    body: "review body",
    outputPath: "reviews/review.md",
    reviews: [
      {
        agentId: "reviewer-a",
        status: "succeeded",
        outputPath: "reviews/reviewer-a/review.md",
      },
      {
        agentId: "reviewer-b",
        status: "succeeded",
        outputPath: "reviews/reviewer-b/review.md",
      },
    ],
    ...overrides,
  };
}

function createApplyStageResult(
  overrides: Partial<AutoApplyStageResult> = {},
): AutoApplyStageResult {
  return {
    body: "apply body",
    exitCode: 0,
    ...overrides,
  };
}

function createReviewerRecommendations(
  preferredAgents: readonly string[],
): ReviewerRecommendation[] {
  return preferredAgents.map((preferredAgent, index) => ({
    reviewerAgentId: `reviewer-${String.fromCharCode(97 + index)}`,
    recommendationPath: `reviews/reviewer-${String.fromCharCode(97 + index)}/recommendation.json`,
    preferredAgent,
  }));
}

describe("executeAutoCommand", () => {
  it("auto-applies from unanimous reviewer recommendations in the application layer", async () => {
    const onEvent = jest.fn();
    const runApplyStage = jest
      .fn<AutoCommandDependencies["runApplyStage"]>()
      .mockResolvedValue(createApplyStageResult());
    const dependencies = createDependencies({
      now: () => 0,
      onEvent,
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(createRunStageResult()),
      runReviewStage: jest
        .fn<AutoCommandDependencies["runReviewStage"]>()
        .mockResolvedValue(createReviewStageResult()),
      runApplyStage,
      loadRecommendation:
        jest.fn<AutoCommandDependencies["loadRecommendation"]>(),
      loadReviewerRecommendations: jest
        .fn<AutoCommandDependencies["loadReviewerRecommendations"]>()
        .mockResolvedValue(createReviewerRecommendations(["beta", "beta"])),
    });

    const result = await executeAutoCommand(
      {
        specPath: "specs/task.md",
        apply: true,
      },
      dependencies,
    );

    expect(runApplyStage).toHaveBeenCalledWith({
      runId: "run-1",
      agentId: "beta",
      commit: false,
    });
    expect(result.auto.status).toBe("succeeded");
    expect(result.apply.status).toBe("succeeded");
    expect(result.appliedAgentId).toBe("beta");
    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "body", body: "run body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "body", body: "review body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ kind: "body", body: "apply body" }),
    );
  });

  it("returns action required when reviewers disagree instead of letting the CLI decide", async () => {
    const runApplyStage = jest.fn<AutoCommandDependencies["runApplyStage"]>();
    const dependencies = createDependencies({
      now: () => 0,
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(
          createRunStageResult({
            report: {
              ...createRunStageResult().report,
              runId: "run-2",
            },
          }),
        ),
      runReviewStage: jest
        .fn<AutoCommandDependencies["runReviewStage"]>()
        .mockResolvedValue(createReviewStageResult()),
      runApplyStage,
      loadRecommendation:
        jest.fn<AutoCommandDependencies["loadRecommendation"]>(),
      loadReviewerRecommendations: jest
        .fn<AutoCommandDependencies["loadReviewerRecommendations"]>()
        .mockResolvedValue(createReviewerRecommendations(["alpha", "beta"])),
    });

    const result = await executeAutoCommand(
      {
        specPath: "specs/task.md",
        apply: true,
      },
      dependencies,
    );

    expect(runApplyStage).not.toHaveBeenCalled();
    expect(result.auto.status).toBe("action_required");
    expect(result.apply.status).toBe("skipped");
    expect(result.auto.detail).toBe(
      "Reviewers disagreed on preferred candidate; manual review required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail:
          "Reviewers disagreed on preferred candidate; manual review required.",
      }),
    );
  });
});
