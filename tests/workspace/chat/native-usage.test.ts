import { describe, expect, it, jest } from "@jest/globals";

import {
  extractProviderNativeTokenUsageForSession,
  tryExtractProviderNativeTokenUsageForSession,
} from "../../../src/workspace/chat/native-usage.js";
import { extractChatUsageFromArtifact } from "../../../src/workspace/chat/usage-extractor.js";

jest.mock("../../../src/workspace/chat/usage-extractor.js", () => ({
  extractChatUsageFromArtifact: jest.fn(),
}));

const extractChatUsageFromArtifactMock = jest.mocked(
  extractChatUsageFromArtifact,
);

describe("extractProviderNativeTokenUsageForSession", () => {
  it("returns chat_not_captured when chat capture is unavailable", async () => {
    const result = await extractProviderNativeTokenUsageForSession({
      root: "/repo",
      domain: "reviews",
      sessionId: "session-1",
      agentId: "agent-1",
      provider: "codex",
      modelId: "gpt-5",
      chatCaptured: false,
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "chat_not_captured",
      provider: "codex",
      modelId: "gpt-5",
      artifactPath: undefined,
      format: undefined,
      message:
        "Chat usage capture was not enabled or did not produce an artifact.",
    });
  });

  it("returns unsupported_provider when the provider is not supported", async () => {
    const result = await extractProviderNativeTokenUsageForSession({
      root: "/repo",
      domain: "specs",
      sessionId: "session-2",
      agentId: "agent-2",
      provider: "openrouter",
      modelId: "some-model",
      chatCaptured: true,
      format: "jsonl",
      artifactPath: "/tmp/chat.jsonl",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "unsupported_provider",
      provider: "openrouter",
      modelId: "some-model",
      artifactPath: "/tmp/chat.jsonl",
      format: "jsonl",
      message:
        "Usage extraction is not implemented for provider `openrouter` yet.",
    });
  });

  it("passes through missing extraction results", async () => {
    extractChatUsageFromArtifactMock.mockResolvedValueOnce({
      status: "unavailable",
      reason: "missing",
      provider: "codex",
      modelId: "gpt-5",
      artifactPath: "/tmp/chat.jsonl",
      format: "jsonl",
      message: "Chat usage artifact was not found.",
    });

    const result = await extractProviderNativeTokenUsageForSession({
      root: "/repo",
      domain: "reduce",
      sessionId: "session-3",
      agentId: "agent-3",
      provider: "codex",
      modelId: "gpt-5",
      chatCaptured: true,
      format: "jsonl",
      artifactPath: "/tmp/chat.jsonl",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "missing",
      provider: "codex",
      modelId: "gpt-5",
      artifactPath: "/tmp/chat.jsonl",
      format: "jsonl",
      message: "Chat usage artifact was not found.",
    });
  });

  it("passes through malformed extraction results", async () => {
    extractChatUsageFromArtifactMock.mockResolvedValueOnce({
      status: "unavailable",
      reason: "malformed",
      provider: "claude",
      modelId: "claude-sonnet",
      artifactPath: "/tmp/chat.jsonl",
      format: "jsonl",
      message: "Invalid JSONL at line 1: bad json",
    });

    const result = await extractProviderNativeTokenUsageForSession({
      root: "/repo",
      domain: "runs",
      sessionId: "session-4",
      agentId: "agent-4",
      provider: "claude",
      modelId: "claude-sonnet",
      chatCaptured: true,
      format: "jsonl",
      artifactPath: "/tmp/chat.jsonl",
    });

    expect(result.status).toBe("unavailable");
    const unavailable = result as Extract<
      typeof result,
      { status: "unavailable" }
    >;
    expect(unavailable.reason).toBe("malformed");
  });

  it("maps thrown extractor failures to extractor_error", async () => {
    extractChatUsageFromArtifactMock.mockRejectedValueOnce(new Error("boom"));

    const result = await extractProviderNativeTokenUsageForSession({
      root: "/repo",
      domain: "runs",
      sessionId: "session-5",
      agentId: "agent-5",
      provider: "gemini",
      modelId: "gemini-2.5-pro",
      chatCaptured: true,
      format: "json",
      artifactPath: "/tmp/chat.json",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "extractor_error",
      provider: "gemini",
      modelId: "gemini-2.5-pro",
      artifactPath: "/tmp/chat.json",
      format: "json",
      message: "Chat usage extraction failed: boom",
    });
  });

  it("returns provider-native tokenUsage only from tryExtract when available", async () => {
    extractChatUsageFromArtifactMock.mockResolvedValueOnce({
      status: "available",
      provider: "codex",
      modelId: "gpt-5",
      artifactPath: "/tmp/chat.jsonl",
      format: "jsonl",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });

    await expect(
      tryExtractProviderNativeTokenUsageForSession({
        root: "/repo",
        domain: "specs",
        sessionId: "session-6",
        agentId: "agent-6",
        provider: "codex",
        modelId: "gpt-5",
        chatCaptured: true,
        format: "jsonl",
        artifactPath: "/tmp/chat.jsonl",
      }),
    ).resolves.toEqual({
      input_tokens: 120,
      cached_input_tokens: 30,
      output_tokens: 45,
      reasoning_output_tokens: 7,
      total_tokens: 202,
    });
  });
});
