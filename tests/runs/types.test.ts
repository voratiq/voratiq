import { runRecordSchema } from "../../src/domains/runs/model/types.js";

const baseRunRecord = {
  runId: "run-123",
  baseRevisionSha: "abc123",
  rootPath: ".",
  spec: { path: "specs/sample.md" },
  status: "succeeded",
  createdAt: "2025-01-01T00:00:00.000Z",
  startedAt: "2025-01-01T00:00:00.500Z",
  completedAt: "2025-01-01T00:05:00.000Z",
  agents: [
    {
      agentId: "agent-1",
      model: "model-v1",
      status: "succeeded",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
      commitSha: "def456",
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

  it("parses persisted auto outcome with action_required and skipped apply", () => {
    const withAutoOutcome = {
      ...baseRunRecord,
      auto: {
        status: "action_required" as const,
        completedAt: "2025-01-01T03:00:00.000Z",
        detail: "manual selection required",
        apply: {
          status: "skipped" as const,
          detail: "no shared recommendation",
        },
      },
    };

    const parsed = runRecordSchema.parse(withAutoOutcome);
    expect(parsed.auto?.status).toBe("action_required");
    expect(parsed.auto?.apply.status).toBe("skipped");
  });

  it("parses run agent provider-native token usage payloads", () => {
    const withTokenUsage = {
      ...baseRunRecord,
      agents: [
        {
          ...baseRunRecord.agents[0],
          tokenUsage: {
            input_tokens: 120,
            cached_input_tokens: 30,
            output_tokens: 45,
            reasoning_output_tokens: 7,
            total_tokens: 202,
          },
        },
      ],
    };

    const parsed = runRecordSchema.parse(withTokenUsage);
    expect(parsed.agents[0]?.tokenUsage).toEqual({
      input_tokens: 120,
      cached_input_tokens: 30,
      output_tokens: 45,
      reasoning_output_tokens: 7,
      total_tokens: 202,
    });
  });
});
