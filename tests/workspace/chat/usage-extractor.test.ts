import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHAT_USAGE_PROVIDER_IDS,
  extractedTokenUsageSchema,
  extractedTokenUsageSchemaByProvider,
} from "../../../src/domain/run/model/types.js";
import type { TokenUsageResult } from "../../../src/workspace/chat/token-usage-result.js";
import { extractChatUsageFromArtifact } from "../../../src/workspace/chat/usage-extractor.js";
import {
  extractObservedProviderNativeUsage,
  PROVIDER_USAGE_SHAPE_MAPPINGS,
} from "../../../src/workspace/chat/usage-mappings.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(
  MODULE_DIR,
  "..",
  "..",
  "fixtures",
  "workspace",
  "chat-usage",
);

function expectAvailable(result: TokenUsageResult) {
  expect(result.status).toBe("available");
  return result as Extract<TokenUsageResult, { status: "available" }>;
}

function expectUnavailable(result: TokenUsageResult) {
  expect(result.status).toBe("unavailable");
  return result as Extract<TokenUsageResult, { status: "unavailable" }>;
}

describe("chat usage contract", () => {
  it("publishes supported providers", () => {
    expect(CHAT_USAGE_PROVIDER_IDS).toEqual(["claude", "codex", "gemini"]);
  });

  it("accepts valid native-only extracted usage payloads for each provider", () => {
    expect(() =>
      extractedTokenUsageSchemaByProvider.codex.parse({
        input_tokens: 10,
        cached_input_tokens: 6,
        output_tokens: 4,
        reasoning_output_tokens: 3,
        total_tokens: 14,
      }),
    ).not.toThrow();

    expect(() =>
      extractedTokenUsageSchemaByProvider.claude.parse({
        input_tokens: 10,
      }),
    ).not.toThrow();

    expect(() =>
      extractedTokenUsageSchemaByProvider.gemini.parse({
        total: 14,
      }),
    ).not.toThrow();
  });

  it("rejects empty native-only extracted usage payloads", () => {
    expect(
      extractedTokenUsageSchemaByProvider.codex.safeParse({}).success,
    ).toBe(false);
    expect(
      extractedTokenUsageSchemaByProvider.claude.safeParse({}).success,
    ).toBe(false);
    expect(
      extractedTokenUsageSchemaByProvider.gemini.safeParse({}).success,
    ).toBe(false);
    expect(extractedTokenUsageSchema.safeParse({}).success).toBe(false);
  });

  it("rejects normalized extracted usage payloads", () => {
    expect(
      extractedTokenUsageSchema.safeParse({
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        providerNativeBreakdown: {
          total_token_usage: {
            input_tokens: 10,
            output_tokens: 4,
            total_tokens: 14,
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe("PROVIDER_USAGE_SHAPE_MAPPINGS", () => {
  it("documents native billing fields for Codex plus future Claude and Gemini coverage", () => {
    expect(PROVIDER_USAGE_SHAPE_MAPPINGS.codex.billingRelevantFields).toEqual([
      expect.objectContaining({
        artifactFieldPath: "event_msg.info.total_token_usage.input_tokens",
        usageFieldPath: "input_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath:
          "event_msg.info.total_token_usage.cached_input_tokens",
        usageFieldPath: "cached_input_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath: "event_msg.info.total_token_usage.output_tokens",
        usageFieldPath: "output_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath:
          "event_msg.info.total_token_usage.reasoning_output_tokens",
        usageFieldPath: "reasoning_output_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath: "event_msg.info.total_token_usage.total_tokens",
        usageFieldPath: "total_tokens",
      }),
    ]);

    expect(
      "providerNativeBreakdownPaths" in PROVIDER_USAGE_SHAPE_MAPPINGS.codex,
    ).toBe(false);

    expect(PROVIDER_USAGE_SHAPE_MAPPINGS.claude.billingRelevantFields).toEqual([
      expect.objectContaining({
        artifactFieldPath: "usage.input_tokens",
        usageFieldPath: "input_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath: "usage.output_tokens",
        usageFieldPath: "output_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath: "usage.cache_read_input_tokens",
        usageFieldPath: "cache_read_input_tokens",
      }),
      expect.objectContaining({
        artifactFieldPath: "usage.cache_creation_input_tokens",
        usageFieldPath: "cache_creation_input_tokens",
      }),
    ]);

    expect(PROVIDER_USAGE_SHAPE_MAPPINGS.gemini.billingRelevantFields).toEqual([
      expect.objectContaining({
        artifactFieldPath: "tokens.input",
        usageFieldPath: "input",
      }),
      expect.objectContaining({
        artifactFieldPath: "tokens.output",
        usageFieldPath: "output",
      }),
      expect.objectContaining({
        artifactFieldPath: "tokens.cached",
        usageFieldPath: "cached",
      }),
      expect.objectContaining({
        artifactFieldPath: "tokens.thoughts",
        usageFieldPath: "thoughts",
      }),
      expect.objectContaining({
        artifactFieldPath: "tokens.tool",
        usageFieldPath: "tool",
      }),
      expect.objectContaining({
        artifactFieldPath: "tokens.total",
        usageFieldPath: "total",
      }),
    ]);
  });
});

describe("extractObservedProviderNativeUsage", () => {
  it("keeps only Claude billing-relevant native usage fields", () => {
    const usage = extractObservedProviderNativeUsage({
      providerId: "claude",
      usagePayload: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 10,
        cache_creation: { ephemeral_5m_input_tokens: 10 },
        service_tier: "standard",
        inference_geo: "not_available",
        server_tool_use: {
          web_search_requests: 0,
          web_fetch_requests: 0,
        },
        iterations: [],
        speed: "standard",
        unknown_field: 3,
      },
    });

    expect(usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 10,
    });
  });

  it("keeps only Gemini billing-relevant native usage fields", () => {
    const usage = extractObservedProviderNativeUsage({
      providerId: "gemini",
      usagePayload: {
        input: 90,
        output: 30,
        cached: 5,
        thoughts: 11,
        tool: 14,
        total: 150,
        extra_bucket: 2,
      },
    });

    expect(usage).toEqual({
      input: 90,
      output: 30,
      cached: 5,
      thoughts: 11,
      tool: 14,
      total: 150,
    });
  });
});

describe("extractChatUsageFromArtifact", () => {
  it("implements artifact extraction in this slice for Codex chat.jsonl files", async () => {
    const artifactPath = resolve(
      FIXTURES_DIR,
      "codex-valid-envelope-a.chat.jsonl",
    );

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    expect(result.status).toBe("available");
  });

  it("extracts native-only Codex token usage from the real event_msg payload envelope", async () => {
    const artifactPath = resolve(
      FIXTURES_DIR,
      "codex-valid-envelope-a.chat.jsonl",
    );

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    expect(result).toEqual({
      status: "available",
      artifactPath,
      format: "jsonl",
      provider: "codex",
      modelId: "gpt-5-3-codex-spark",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });
    const available = expectAvailable(result);
    expect(available.tokenUsage).not.toHaveProperty("last_token_usage");
    expect(available.tokenUsage).not.toHaveProperty("model_context_window");
  });

  it("extracts native-only Codex token usage from the legacy nested event_msg envelope", async () => {
    const artifactPath = resolve(
      FIXTURES_DIR,
      "codex-valid-envelope-b.chat.jsonl",
    );

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    expect(result).toEqual({
      status: "available",
      artifactPath,
      format: "jsonl",
      provider: "codex",
      modelId: "gpt-5-3-codex-spark",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });
    const available = expectAvailable(result);
    expect(available.tokenUsage).not.toHaveProperty("last_token_usage");
    expect(available.tokenUsage).not.toHaveProperty("model_context_window");
  });

  it("returns an empty result when the artifact has no supported Codex usage events", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "codex-empty.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("missing");
    expect(unavailable.tokenUsage).toBeUndefined();
    expect(unavailable.message).toContain("No Codex token_count usage events");
  });

  it("returns a missing result when the artifact path does not exist", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "does-not-exist.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("missing");
    expect(unavailable.tokenUsage).toBeUndefined();
  });

  it("returns a malformed result when the artifact JSONL is invalid", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "codex-malformed.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("malformed");
    expect(unavailable.tokenUsage).toBeUndefined();
    expect(unavailable.message).toContain("Invalid JSONL at line 2");
  });

  it("extracts native-only Claude token usage from message.usage payloads", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "claude-valid.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "claude",
      modelId: "claude-opus-4-6",
    });

    expect(result).toEqual({
      status: "available",
      artifactPath,
      format: "jsonl",
      provider: "claude",
      modelId: "claude-opus-4-6",
      tokenUsage: {
        input_tokens: 210,
        output_tokens: 65,
        cache_read_input_tokens: 41,
        cache_creation_input_tokens: 11,
      },
    });
    const available = expectAvailable(result);
    expect(available.tokenUsage).not.toHaveProperty("service_tier");
    expect(available.tokenUsage).not.toHaveProperty("cache_creation");
    expect(available.tokenUsage).not.toHaveProperty("inference_geo");
    expect(available.tokenUsage).not.toHaveProperty("server_tool_use");
    expect(available.tokenUsage).not.toHaveProperty("iterations");
    expect(available.tokenUsage).not.toHaveProperty("speed");
  });

  it("ignores Codex token_count events with null info and strips non-billing fields", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "codex-valid.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5-3-codex-spark",
    });

    expect(result).toEqual({
      status: "available",
      artifactPath,
      format: "jsonl",
      provider: "codex",
      modelId: "gpt-5-3-codex-spark",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });
    const available = expectAvailable(result);
    expect(available.tokenUsage).not.toHaveProperty("uncategorized_tokens");
    expect(available.tokenUsage).not.toHaveProperty("last_token_usage");
    expect(available.tokenUsage).not.toHaveProperty("stream_id");
  });

  it("returns an empty result when the Claude artifact has no message.usage payloads", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "claude-empty.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "claude",
      modelId: "claude-opus-4-6",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("missing");
    expect(unavailable.tokenUsage).toBeUndefined();
    expect(unavailable.message).toContain("No Claude message.usage payloads");
  });

  it("returns a malformed result when Claude message.usage lacks billing fields", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "claude-malformed.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "claude",
      modelId: "claude-opus-4-6",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("malformed");
    expect(unavailable.tokenUsage).toBeUndefined();
    expect(unavailable.message).toContain(
      "Claude message.usage at line 1 did not contain any valid token usage fields.",
    );
  });

  it("extracts native-only Gemini token usage from bundled transcript tokens payloads", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "gemini-valid.chat.json");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "json",
      providerId: "gemini",
      modelId: "gemini-2-5-pro",
    });

    expect(result).toEqual({
      status: "available",
      artifactPath,
      format: "json",
      provider: "gemini",
      modelId: "gemini-2-5-pro",
      tokenUsage: {
        input: 210,
        output: 66,
        cached: 34,
        thoughts: 14,
        tool: 18,
        total: 342,
      },
    });
    const available = expectAvailable(result);
    expect(available.tokenUsage).not.toHaveProperty("ignored_bucket");
  });

  it("extracts native-only Gemini token usage from JSONL rows and deduplicates response updates", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "gemini-valid.chat.jsonl");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "jsonl",
      providerId: "gemini",
      modelId: "gemini-3-flash-preview",
    });

    expect(result).toEqual({
      status: "available",
      artifactPath,
      format: "jsonl",
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      tokenUsage: {
        input: 28037,
        output: 225,
        cached: 11605,
        thoughts: 865,
        tool: 0,
        total: 29127,
      },
    });
    const available = expectAvailable(result);
    expect(available.tokenUsage).not.toHaveProperty("ignored_bucket");
  });

  it("returns an empty result when the Gemini artifact has no tokens payloads", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "gemini-empty.chat.json");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "json",
      providerId: "gemini",
      modelId: "gemini-2-5-pro",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("missing");
    expect(unavailable.tokenUsage).toBeUndefined();
    expect(unavailable.message).toContain("No Gemini tokens payloads");
  });

  it("returns a malformed result when Gemini tokens lack billing fields", async () => {
    const artifactPath = resolve(FIXTURES_DIR, "gemini-malformed.chat.json");

    const result = await extractChatUsageFromArtifact({
      artifactPath,
      format: "json",
      providerId: "gemini",
      modelId: "gemini-2-5-pro",
    });

    const unavailable = expectUnavailable(result);
    expect(unavailable.reason).toBe("malformed");
    expect(unavailable.tokenUsage).toBeUndefined();
    expect(unavailable.message).toContain(
      "Gemini transcripts[0].payload.tokens did not contain any valid token usage fields.",
    );
  });

  it.each([
    {
      fixtureName: "codex-real-20260121.chat.jsonl",
      providerId: "codex" as const,
      modelId: "gpt-5.1-codex-max",
      format: "jsonl" as const,
      expected: {
        input_tokens: 1472927,
        cached_input_tokens: 1349760,
        output_tokens: 27755,
        reasoning_output_tokens: 22848,
        total_tokens: 1500682,
      },
    },
    {
      fixtureName: "codex-real-20260309.chat.jsonl",
      providerId: "codex" as const,
      modelId: "gpt-5.4",
      format: "jsonl" as const,
      expected: {
        input_tokens: 1057391,
        cached_input_tokens: 999040,
        output_tokens: 10315,
        reasoning_output_tokens: 1737,
        total_tokens: 1067706,
      },
    },
  ])(
    "matches cumulative Codex totals for $fixtureName",
    async ({ expected, fixtureName, format, modelId, providerId }) => {
      const artifactPath = resolve(FIXTURES_DIR, fixtureName);

      const result = await extractChatUsageFromArtifact({
        artifactPath,
        format,
        providerId,
        modelId,
      });

      expect(result).toEqual({
        status: "available",
        artifactPath,
        format,
        provider: providerId,
        modelId,
        tokenUsage: expected,
      });
    },
  );

  it.each([
    {
      fixtureName: "claude-real-20260128.chat.jsonl",
      modelId: "claude-opus-4-5-20251101",
      expected: {
        input_tokens: 2,
        output_tokens: 1268,
        cache_read_input_tokens: 206258,
        cache_creation_input_tokens: 31539,
      },
    },
    {
      fixtureName: "claude-real-20260309.chat.jsonl",
      modelId: "claude-sonnet-4-6",
      expected: {
        input_tokens: 67414,
        output_tokens: 46083,
        cache_read_input_tokens: 14515557,
        cache_creation_input_tokens: 364110,
      },
    },
  ])(
    "aggregates Claude message.usage across assistant messages for $fixtureName",
    async ({ expected, fixtureName, modelId }) => {
      const artifactPath = resolve(FIXTURES_DIR, fixtureName);

      const result = await extractChatUsageFromArtifact({
        artifactPath,
        format: "jsonl",
        providerId: "claude",
        modelId,
      });

      expect(result).toEqual({
        status: "available",
        artifactPath,
        format: "jsonl",
        provider: "claude",
        modelId,
        tokenUsage: expected,
      });
    },
  );

  it.each([
    {
      fixtureName: "gemini-real-20260113.chat.json",
      modelId: "gemini-2.5-pro",
      expected: {
        input: 586065,
        output: 2438,
        cached: 497672,
        thoughts: 3087,
        tool: 0,
        total: 591590,
      },
    },
    {
      fixtureName: "gemini-real-20260303.chat.json",
      modelId: "gemini-3.1-pro-preview",
      expected: {
        input: 1044266,
        output: 2431,
        cached: 861396,
        thoughts: 6589,
        tool: 0,
        total: 1053286,
      },
    },
  ])(
    "extracts Gemini usage from messages[].tokens for $fixtureName",
    async ({ expected, fixtureName, modelId }) => {
      const artifactPath = resolve(FIXTURES_DIR, fixtureName);

      const result = await extractChatUsageFromArtifact({
        artifactPath,
        format: "json",
        providerId: "gemini",
        modelId,
      });

      expect(result).toEqual({
        status: "available",
        artifactPath,
        format: "json",
        provider: "gemini",
        modelId,
        tokenUsage: expected,
      });
    },
  );

  it.each([
    {
      providerId: "claude" as const,
      modelId: "claude-opus-4-6",
      artifactPath: resolve(FIXTURES_DIR, "claude-valid.chat.jsonl"),
      format: "json" as const,
      expectedMessage:
        "Claude usage extraction expects a jsonl artifact, received `json`.",
    },
    {
      providerId: "codex" as const,
      modelId: "gpt-5-3-codex-spark",
      artifactPath: resolve(FIXTURES_DIR, "codex-valid-envelope-a.chat.jsonl"),
      format: "json" as const,
      expectedMessage:
        "Codex usage extraction expects a jsonl artifact, received `json`.",
    },
  ])(
    "returns unsupported for $providerId artifact extraction when the artifact format does not match the provider contract",
    async ({ artifactPath, expectedMessage, format, modelId, providerId }) => {
      const result = await extractChatUsageFromArtifact({
        artifactPath,
        format,
        providerId,
        modelId,
      });

      const unavailable = expectUnavailable(result);
      expect(unavailable.reason).toBe("unsupported_provider");
      expect(unavailable.tokenUsage).toBeUndefined();
      expect(unavailable.message).toBe(expectedMessage);
    },
  );

  it.each([
    {
      providerId: "claude" as const,
      modelId: "claude-opus-4-6",
      artifactPath: resolve(FIXTURES_DIR, "does-not-exist.chat.jsonl"),
      format: "jsonl" as const,
    },
    {
      providerId: "gemini" as const,
      modelId: "gemini-2-5-pro",
      artifactPath: resolve(FIXTURES_DIR, "does-not-exist.chat.json"),
      format: "json" as const,
    },
  ])(
    "returns missing for $providerId artifact extraction when the artifact path does not exist",
    async ({ artifactPath, format, modelId, providerId }) => {
      const result = await extractChatUsageFromArtifact({
        artifactPath,
        format,
        providerId,
        modelId,
      });

      const unavailable = expectUnavailable(result);
      expect(unavailable.reason).toBe("missing");
      expect(unavailable.tokenUsage).toBeUndefined();
      expect(unavailable.message).toBe("Chat usage artifact was not found.");
    },
  );

  it("keeps provider-native extraction self-contained at the extractor boundary", async () => {
    const claudeArtifactPath = resolve(FIXTURES_DIR, "claude-valid.chat.jsonl");
    const geminiArtifactPath = resolve(FIXTURES_DIR, "gemini-valid.chat.json");

    const claudeResult = await extractChatUsageFromArtifact({
      artifactPath: claudeArtifactPath,
      format: "jsonl",
      providerId: "claude",
      modelId: "claude-opus-4-6",
    });
    const geminiResult = await extractChatUsageFromArtifact({
      artifactPath: geminiArtifactPath,
      format: "json",
      providerId: "gemini",
      modelId: "gemini-2-5-pro",
    });

    expect(claudeResult).toEqual({
      status: "available",
      artifactPath: claudeArtifactPath,
      format: "jsonl",
      provider: "claude",
      modelId: "claude-opus-4-6",
      tokenUsage: {
        input_tokens: 210,
        output_tokens: 65,
        cache_read_input_tokens: 41,
        cache_creation_input_tokens: 11,
      },
    });
    expect(geminiResult).toEqual({
      status: "available",
      artifactPath: geminiArtifactPath,
      format: "json",
      provider: "gemini",
      modelId: "gemini-2-5-pro",
      tokenUsage: {
        input: 210,
        output: 66,
        cached: 34,
        thoughts: 14,
        tool: 18,
        total: 342,
      },
    });
  });
});
