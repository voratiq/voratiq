import { describe, expect, it } from "@jest/globals";

import { specRecordSchema } from "../../src/domains/specs/model/types.js";

describe("specRecordSchema", () => {
  it("parses provider-native token usage payloads", () => {
    const parsed = specRecordSchema.parse({
      sessionId: "spec-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.500Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      status: "saved",
      agentId: "spec-agent",
      title: "Spec title",
      slug: "spec-title",
      outputPath: ".voratiq/specs/spec-title.md",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
      error: null,
    });

    expect(parsed.tokenUsage).toEqual({
      input_tokens: 120,
      cached_input_tokens: 30,
      output_tokens: 45,
      reasoning_output_tokens: 7,
      total_tokens: 202,
    });
  });
});
