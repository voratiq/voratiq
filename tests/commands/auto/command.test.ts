import { jest } from "@jest/globals";

import {
  type AutoApplyStageResult,
  type AutoCommandDependencies,
  type AutoReviewStageResult,
  type AutoRunStageResult,
  executeAutoCommand,
} from "../../../src/commands/auto/command.js";
import type { ReviewSelectionInput } from "../../../src/policy/index.js";

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
  const loadReviewSelectionInput: jest.MockedFunction<
    AutoCommandDependencies["loadReviewSelectionInput"]
  > = jest.fn();

  return {
    runSpecStage,
    runRunStage,
    runReviewStage,
    runApplyStage,
    loadReviewSelectionInput,
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
    reviewId: "review-1",
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

function createReviewSelectionInput(
  preferredAgents: readonly string[],
): ReviewSelectionInput {
  return preferredAgents
    .map((preferredAgent, index) => ({
      reviewerAgentId: `reviewer-${String.fromCharCode(97 + index)}`,
      status: "succeeded" as const,
      preferredCandidateId: preferredAgent,
      resolvedPreferredCandidateId: preferredAgent,
    }))
    .reduce<ReviewSelectionInput>(
      (input, reviewer) => ({
        ...input,
        reviewers: [...input.reviewers, reviewer],
      }),
      {
        canonicalAgentIds: ["alpha", "beta"],
        reviewers: [],
      },
    );
}

describe("executeAutoCommand", () => {
  it("returns action required when spec generation produces multiple drafts", async () => {
    const runRunStage = jest.fn<AutoCommandDependencies["runRunStage"]>();
    const dependencies = createDependencies({
      now: () => 0,
      runSpecStage: jest
        .fn<AutoCommandDependencies["runSpecStage"]>()
        .mockResolvedValue({
          body: "spec body",
          generatedSpecPaths: ["specs/a.md", "specs/b.md"],
        }),
      runRunStage,
    });

    const result = await executeAutoCommand(
      {
        description: "Define the task",
        apply: true,
      },
      dependencies,
    );

    expect(runRunStage).not.toHaveBeenCalled();
    expect(result.auto.status).toBe("action_required");
    expect(result.auto.detail).toBe(
      "Multiple specs generated; manual selection required.",
    );
    expect(result.apply.status).toBe("skipped");
    expect(result.summary.spec.detail).toBe(
      "Multiple specs generated; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail: "Multiple specs generated; manual selection required.",
        message: "Multiple specs generated; manual selection required.",
      }),
    );
  });

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
      loadReviewSelectionInput: jest
        .fn<AutoCommandDependencies["loadReviewSelectionInput"]>()
        .mockResolvedValue(createReviewSelectionInput(["beta", "beta"])),
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
      loadReviewSelectionInput: jest
        .fn<AutoCommandDependencies["loadReviewSelectionInput"]>()
        .mockResolvedValue(createReviewSelectionInput(["alpha", "beta"])),
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
        message:
          "Reviewers disagreed on preferred candidate; manual review required.",
      }),
    );
  });
});
