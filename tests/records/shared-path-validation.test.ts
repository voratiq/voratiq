import { reductionRecordSchema } from "../../src/domains/reductions/model/types.js";
import { reviewRecordSchema } from "../../src/domains/reviews/model/types.js";
import { runRecordSchema } from "../../src/domains/runs/model/types.js";
import { specRecordSchema } from "../../src/domains/specs/model/types.js";

describe("shared record path validation", () => {
  it("rejects the same invalid repo-relative path across spec, run, review, and reduction records", () => {
    const invalidPath = "../outside";

    const specResult = specRecordSchema.safeParse({
      sessionId: "spec-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "saved",
      agentId: "agent-1",
      title: "Spec",
      slug: "spec",
      outputPath: invalidPath,
    });

    const runResult = runRecordSchema.safeParse({
      runId: "run-123",
      baseRevisionSha: "abc123",
      rootPath: invalidPath,
      spec: { path: invalidPath },
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      agents: [
        {
          agentId: "agent-1",
          model: "model-v1",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          evals: [
            {
              slug: "lint",
              status: "succeeded",
            },
          ],
        },
      ],
    });

    const reviewResult = reviewRecordSchema.safeParse({
      sessionId: "review-123",
      runId: "run-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "succeeded",
      reviewers: [
        {
          agentId: "reviewer-1",
          status: "succeeded",
          outputPath: invalidPath,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    });

    const reductionResult = reductionRecordSchema.safeParse({
      sessionId: "reduction-123",
      target: { type: "run", id: "run-123" },
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "succeeded",
      reducers: [
        {
          agentId: "reducer-1",
          status: "succeeded",
          outputPath: invalidPath,
          dataPath: invalidPath,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    });

    const expectedMessage =
      "Path \"../outside\" must be repo-relative, use forward slashes, and omit '.' or '..' segments.";

    expect(specResult.success).toBe(false);
    expect(runResult.success).toBe(false);
    expect(reviewResult.success).toBe(false);
    expect(reductionResult.success).toBe(false);

    expect(specResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(runResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(runResult.error?.issues[1]?.message).toBe(expectedMessage);
    expect(reviewResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(reductionResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(reductionResult.error?.issues[1]?.message).toBe(expectedMessage);
  });
});
