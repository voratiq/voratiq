import { describe, expect, it } from "@jest/globals";

import { specRecordSchema } from "../../src/domain/spec/model/types.js";

describe("specRecordSchema", () => {
  it("remains backward-compatible with legacy records that predate baseRevisionSha", () => {
    const parsed = specRecordSchema.parse({
      sessionId: "spec-legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.500Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      status: "succeeded",
      description: "Legacy spec title",
      agents: [
        {
          agentId: "spec-agent",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.500Z",
          completedAt: "2026-01-01T00:00:02.000Z",
          outputPath: ".voratiq/spec/spec-title.md",
          dataPath: ".voratiq/spec/spec-title.json",
        },
      ],
      error: null,
    });

    expect(parsed.baseRevisionSha).toBeUndefined();
  });

  it("parses provider-native token usage payloads within agents", () => {
    const parsed = specRecordSchema.parse({
      sessionId: "spec-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.500Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      status: "succeeded",
      baseRevisionSha: "abc123",
      description: "Spec title",
      agents: [
        {
          agentId: "spec-agent",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.500Z",
          completedAt: "2026-01-01T00:00:02.000Z",
          outputPath: ".voratiq/spec/spec-title.md",
          dataPath: ".voratiq/spec/spec-title.json",
          tokenUsage: {
            input_tokens: 120,
            cached_input_tokens: 30,
            output_tokens: 45,
            reasoning_output_tokens: 7,
            total_tokens: 202,
          },
        },
      ],
      error: null,
    });

    expect(parsed.agents[0]?.tokenUsage).toEqual({
      input_tokens: 120,
      cached_input_tokens: 30,
      output_tokens: 45,
      reasoning_output_tokens: 7,
      total_tokens: 202,
    });
    expect(parsed.baseRevisionSha).toBe("abc123");
  });
});
