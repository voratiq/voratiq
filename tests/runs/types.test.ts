import { runRecordSchema } from "../../src/runs/records/types.js";

const baseRunRecord = {
  runId: "run-123",
  baseRevisionSha: "abc123",
  rootPath: ".",
  spec: { path: "specs/sample.md" },
  status: "succeeded",
  createdAt: "2025-01-01T00:00:00.000Z",
  agents: [
    {
      agentId: "agent-1",
      model: "model-v1",
      status: "succeeded",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
      commitSha: "def456",
      evals: [
        {
          slug: "lint",
          status: "succeeded",
          exitCode: 0,
          command: "npm run lint",
        },
      ],
    },
  ],
  deletedAt: null,
} as const;

describe("runRecordSchema", () => {
  it("parses records without applyStatus", () => {
    expect(() => runRecordSchema.parse(baseRunRecord)).not.toThrow();
  });

  it("parses records with applyStatus", () => {
    const withApplyStatus = {
      ...baseRunRecord,
      applyStatus: {
        agentId: "agent-1",
        status: "succeeded",
        appliedAt: "2025-01-01T01:00:00.000Z",
        ignoredBaseMismatch: false,
      },
    };

    const parsed = runRecordSchema.parse(withApplyStatus);
    expect(parsed.applyStatus?.status).toBe("succeeded");
    expect(parsed.applyStatus?.detail ?? undefined).toBeUndefined();
  });

  it("parses applyStatus with nullable detail", () => {
    const withDetail = {
      ...baseRunRecord,
      applyStatus: {
        agentId: "agent-1",
        status: "failed" as const,
        appliedAt: "2025-01-01T02:00:00.000Z",
        ignoredBaseMismatch: true,
        detail: "detail",
      },
    };

    const parsed = runRecordSchema.parse(withDetail);
    expect(parsed.applyStatus?.detail).toBe("detail");
  });
});
