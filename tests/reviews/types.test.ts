import { describe, expect, it } from "@jest/globals";

import { reviewRecordSchema } from "../../src/domains/reviews/model/types.js";

describe("reviewRecordSchema", () => {
  it("parses reviewer provider-native token usage payloads", () => {
    const parsed = reviewRecordSchema.parse({
      sessionId: "review-123",
      runId: "run-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.500Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      status: "succeeded",
      reviewers: [
        {
          agentId: "reviewer-a",
          status: "succeeded",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
          startedAt: "2026-01-01T00:00:01.000Z",
          completedAt: "2026-01-01T00:00:02.000Z",
          tokenUsage: {
            input_tokens: 210,
            output_tokens: 65,
            cache_read_input_tokens: 41,
            cache_creation_input_tokens: 11,
          },
          error: null,
        },
      ],
      error: null,
    });

    expect(parsed.reviewers[0]?.tokenUsage).toEqual({
      input_tokens: 210,
      output_tokens: 65,
      cache_read_input_tokens: 41,
      cache_creation_input_tokens: 11,
    });
  });
});
