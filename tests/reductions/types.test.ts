import { describe, expect, it } from "@jest/globals";

import { reductionRecordSchema } from "../../src/domains/reductions/model/types.js";

describe("reductionRecordSchema", () => {
  it("parses reducer provider-native token usage payloads", () => {
    const parsed = reductionRecordSchema.parse({
      sessionId: "reduce-123",
      target: { type: "spec", id: "spec-123" },
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "succeeded",
      reducers: [
        {
          agentId: "reducer-a",
          status: "succeeded",
          outputPath:
            ".voratiq/reductions/sessions/reduce-123/reducer-a/artifacts/reduction.md",
          dataPath:
            ".voratiq/reductions/sessions/reduce-123/reducer-a/artifacts/reduction.json",
          startedAt: "2026-01-01T00:00:01.000Z",
          completedAt: "2026-01-01T00:00:02.000Z",
          tokenUsage: {
            input: 100,
            output: 25,
            cached: 10,
            thoughts: 8,
            tool: 4,
            total: 147,
          },
          error: null,
        },
      ],
      error: null,
    });

    expect(parsed.reducers[0]?.tokenUsage).toEqual({
      input: 100,
      output: 25,
      cached: 10,
      thoughts: 8,
      tool: 4,
      total: 147,
    });
  });
});
