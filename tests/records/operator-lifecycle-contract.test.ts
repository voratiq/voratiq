import { describe, expect, it } from "@jest/globals";

import {
  reductionRecordReducerSchema,
  reductionRecordSchema,
} from "../../src/domains/reductions/model/types.js";
import {
  reviewRecordReviewerSchema,
  reviewRecordSchema,
} from "../../src/domains/reviews/model/types.js";
import {
  agentInvocationRecordSchema,
  runRecordSchema,
} from "../../src/domains/runs/model/types.js";
import { specRecordSchema } from "../../src/domains/specs/model/types.js";

const QUEUED_AT = "2026-01-01T00:00:00.000Z";
const STARTED_AT = "2026-01-01T00:00:01.000Z";
const COMPLETED_AT = "2026-01-01T00:00:02.000Z";

function buildRunAgent(
  status: "queued" | "running" | "succeeded",
): Record<string, unknown> {
  if (status === "queued") {
    return {
      agentId: "agent-a",
      model: "gpt-5",
      status,
    };
  }

  if (status === "running") {
    return {
      agentId: "agent-a",
      model: "gpt-5",
      status,
      startedAt: STARTED_AT,
    };
  }

  return {
    agentId: "agent-a",
    model: "gpt-5",
    status,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    evals: [
      {
        slug: "tests",
        status: "succeeded",
      },
    ],
  };
}

describe("unified operator lifecycle contract", () => {
  it("rejects legacy-shaped records missing canonical lifecycle timestamps", () => {
    const specMissingStartedAt = specRecordSchema.safeParse({
      sessionId: "spec-legacy",
      createdAt: QUEUED_AT,
      status: "drafting",
      agentId: "spec-agent",
      title: "Title",
      slug: "title",
      outputPath: ".voratiq/specs/title.md",
    });
    expect(specMissingStartedAt.success).toBe(false);
    expect(
      specMissingStartedAt.success
        ? []
        : specMissingStartedAt.error.issues.map((issue) => issue.path[0]),
    ).toContain("startedAt");

    const runMissingCompletedAt = runRecordSchema.safeParse({
      runId: "run-legacy",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "succeeded",
      createdAt: QUEUED_AT,
      startedAt: STARTED_AT,
      agents: [buildRunAgent("succeeded")],
      deletedAt: null,
    });
    expect(runMissingCompletedAt.success).toBe(false);
    expect(
      runMissingCompletedAt.success
        ? []
        : runMissingCompletedAt.error.issues.map((issue) => issue.path[0]),
    ).toContain("completedAt");

    const reviewMissingStartedAt = reviewRecordSchema.safeParse({
      sessionId: "review-legacy",
      runId: "run-legacy",
      status: "running",
      createdAt: QUEUED_AT,
      reviewers: [
        {
          agentId: "reviewer-a",
          status: "running",
          outputPath:
            ".voratiq/reviews/sessions/review-legacy/reviewer-a/artifacts/review.md",
          startedAt: STARTED_AT,
        },
      ],
    });
    expect(reviewMissingStartedAt.success).toBe(false);
    expect(
      reviewMissingStartedAt.success
        ? []
        : reviewMissingStartedAt.error.issues.map((issue) => issue.path[0]),
    ).toContain("startedAt");

    const reductionMissingCompletedAt = reductionRecordSchema.safeParse({
      sessionId: "reduce-legacy",
      target: { type: "run", id: "run-legacy" },
      status: "succeeded",
      createdAt: QUEUED_AT,
      startedAt: STARTED_AT,
      reducers: [
        {
          agentId: "reducer-a",
          status: "succeeded",
          outputPath:
            ".voratiq/reductions/sessions/reduce-legacy/reducer-a/artifacts/reduction.md",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          error: null,
        },
      ],
      error: null,
    });
    expect(reductionMissingCompletedAt.success).toBe(false);
    expect(
      reductionMissingCompletedAt.success
        ? []
        : reductionMissingCompletedAt.error.issues.map(
            (issue) => issue.path[0],
          ),
    ).toContain("completedAt");
  });

  it("keeps queued/running/terminal timestamp parity across run/review/reduce records", () => {
    const queuedRecords = [
      runRecordSchema.parse({
        runId: "run-q",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "specs/demo.md" },
        status: "queued",
        createdAt: QUEUED_AT,
        agents: [buildRunAgent("queued")],
      }),
      reviewRecordSchema.parse({
        sessionId: "review-q",
        runId: "run-q",
        status: "queued",
        createdAt: QUEUED_AT,
        reviewers: [
          {
            agentId: "reviewer-a",
            status: "queued",
            outputPath:
              ".voratiq/reviews/sessions/review-q/reviewer-a/artifacts/review.md",
          },
        ],
      }),
      reductionRecordSchema.parse({
        sessionId: "reduce-q",
        target: { type: "run", id: "run-q" },
        status: "queued",
        createdAt: QUEUED_AT,
        reducers: [
          {
            agentId: "reducer-a",
            status: "queued",
            outputPath:
              ".voratiq/reductions/sessions/reduce-q/reducer-a/artifacts/reduction.md",
          },
        ],
      }),
    ];
    for (const record of queuedRecords) {
      expect(record.startedAt).toBeUndefined();
      expect(record.completedAt).toBeUndefined();
    }

    const runningRecords = [
      specRecordSchema.parse({
        sessionId: "spec-r",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        status: "drafting",
        agentId: "spec-agent",
        title: "Title",
        slug: "title",
        outputPath: ".voratiq/specs/title.md",
      }),
      runRecordSchema.parse({
        runId: "run-r",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "specs/demo.md" },
        status: "running",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        agents: [buildRunAgent("running")],
      }),
      reviewRecordSchema.parse({
        sessionId: "review-r",
        runId: "run-r",
        status: "running",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        reviewers: [
          {
            agentId: "reviewer-a",
            status: "running",
            outputPath:
              ".voratiq/reviews/sessions/review-r/reviewer-a/artifacts/review.md",
            startedAt: STARTED_AT,
          },
        ],
      }),
      reductionRecordSchema.parse({
        sessionId: "reduce-r",
        target: { type: "run", id: "run-r" },
        status: "running",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        reducers: [
          {
            agentId: "reducer-a",
            status: "running",
            outputPath:
              ".voratiq/reductions/sessions/reduce-r/reducer-a/artifacts/reduction.md",
            startedAt: STARTED_AT,
          },
        ],
      }),
    ];
    for (const record of runningRecords) {
      expect(record.startedAt).toEqual(expect.any(String));
      expect(record.completedAt).toBeUndefined();
    }

    const terminalRecords = [
      specRecordSchema.parse({
        sessionId: "spec-t",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        status: "saved",
        agentId: "spec-agent",
        title: "Title",
        slug: "title",
        outputPath: ".voratiq/specs/title.md",
      }),
      runRecordSchema.parse({
        runId: "run-t",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "specs/demo.md" },
        status: "succeeded",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        agents: [buildRunAgent("succeeded")],
      }),
      reviewRecordSchema.parse({
        sessionId: "review-t",
        runId: "run-t",
        status: "succeeded",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        reviewers: [
          {
            agentId: "reviewer-a",
            status: "succeeded",
            outputPath:
              ".voratiq/reviews/sessions/review-t/reviewer-a/artifacts/review.md",
            startedAt: STARTED_AT,
            completedAt: COMPLETED_AT,
            error: null,
          },
        ],
        error: null,
      }),
      reductionRecordSchema.parse({
        sessionId: "reduce-t",
        target: { type: "run", id: "run-t" },
        status: "succeeded",
        createdAt: QUEUED_AT,
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        reducers: [
          {
            agentId: "reducer-a",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-t/reducer-a/artifacts/reduction.md",
            startedAt: STARTED_AT,
            completedAt: COMPLETED_AT,
            error: null,
          },
        ],
        error: null,
      }),
    ];
    for (const record of terminalRecords) {
      expect(record.startedAt).toEqual(expect.any(String));
      expect(record.completedAt).toEqual(expect.any(String));
    }
  });

  it("enforces timestamp lifecycle transitions for persisted stage records", () => {
    expect(() =>
      agentInvocationRecordSchema.parse({
        agentId: "agent-a",
        model: "gpt-5",
        status: "running",
      }),
    ).toThrow(/startedAt/u);

    expect(() =>
      reviewRecordReviewerSchema.parse({
        agentId: "reviewer-a",
        status: "queued",
        outputPath:
          ".voratiq/reviews/sessions/review-1/reviewer-a/artifacts/review.md",
        startedAt: STARTED_AT,
      }),
    ).toThrow(/queued/u);

    expect(() =>
      reductionRecordReducerSchema.parse({
        agentId: "reducer-a",
        status: "succeeded",
        outputPath:
          ".voratiq/reductions/sessions/reduce-1/reducer-a/artifacts/reduction.md",
        startedAt: STARTED_AT,
      }),
    ).toThrow(/completedAt/u);
  });
});
