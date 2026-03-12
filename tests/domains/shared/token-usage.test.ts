import { describe, expect, it } from "@jest/globals";

import {
  buildUnavailableTokenUsageResult,
  reconstructTokenUsageResult,
  resolveTokenUsage,
} from "../../../src/domains/shared/token-usage.js";

describe("token usage shared helpers", () => {
  it("builds the default unavailable result and preserves metadata", () => {
    expect(
      buildUnavailableTokenUsageResult({
        provider: "codex",
        modelId: "gpt-5",
        artifactPath: "/tmp/chat.jsonl",
        format: "jsonl",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "chat_not_captured",
      provider: "codex",
      modelId: "gpt-5",
      artifactPath: "/tmp/chat.jsonl",
      format: "jsonl",
      message:
        "Chat usage capture was not enabled or did not produce an artifact.",
    });
  });

  it("derives token usage from available results", () => {
    expect(
      resolveTokenUsage({
        status: "available",
        provider: "claude",
        modelId: "claude-sonnet",
        tokenUsage: {
          input_tokens: 210,
          output_tokens: 65,
          cache_read_input_tokens: 41,
          cache_creation_input_tokens: 11,
        },
      }),
    ).toEqual({
      input_tokens: 210,
      output_tokens: 65,
      cache_read_input_tokens: 41,
      cache_creation_input_tokens: 11,
    });
  });

  it("returns undefined for unavailable results", () => {
    expect(
      resolveTokenUsage({
        status: "unavailable",
        reason: "extractor_error",
        provider: "gemini",
        modelId: "gemini-2.5-pro",
        message: "Chat usage extraction failed: boom",
      }),
    ).toBeUndefined();
  });

  it("reconstructs available results from persisted token usage", () => {
    expect(
      reconstructTokenUsageResult({
        provider: "gemini",
        modelId: "gemini-2.5-pro",
        artifactPath: "/tmp/chat.json",
        format: "json",
        tokenUsage: {
          input: 80,
          output: 22,
          cached: 6,
          thoughts: 5,
          tool: 3,
          total: 116,
        },
      }),
    ).toEqual({
      status: "available",
      provider: "gemini",
      modelId: "gemini-2.5-pro",
      artifactPath: "/tmp/chat.json",
      format: "json",
      tokenUsage: {
        input: 80,
        output: 22,
        cached: 6,
        thoughts: 5,
        tool: 3,
        total: 116,
      },
    });
  });

  it("reconstructs unavailable results with fallback provider and model defaults", () => {
    expect(reconstructTokenUsageResult({})).toEqual({
      status: "unavailable",
      reason: "chat_not_captured",
      provider: "unknown",
      modelId: "unknown",
      message:
        "Chat usage capture was not enabled or did not produce an artifact.",
    });
  });
});
