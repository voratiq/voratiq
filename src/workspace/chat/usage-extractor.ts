import { readFile } from "node:fs/promises";

import type {
  ChatUsageProviderId,
  ExtractedTokenUsage,
} from "../../domain/run/model/types.js";
import { isMissing } from "../../utils/fs.js";
import type {
  TokenUsageResult,
  TokenUsageUnavailableReason,
} from "./token-usage-result.js";
import type { ChatArtifactFormat } from "./types.js";
import {
  extractObservedProviderNativeUsage,
  PROVIDER_USAGE_SHAPE_MAPPINGS,
} from "./usage-mappings.js";

export interface ExtractChatUsageArtifactOptions {
  artifactPath: string;
  format: ChatArtifactFormat;
  providerId: ChatUsageProviderId;
  modelId: string;
}

export type ChatUsageExtractionResult = TokenUsageResult;

interface ExtractCodexChatUsageFromJsonlOptions {
  artifactPath: string;
  content: string;
  modelId: string;
}

interface ExtractClaudeChatUsageFromJsonlOptions {
  artifactPath: string;
  content: string;
  modelId: string;
}

interface ExtractGeminiChatUsageFromJsonlOptions {
  artifactPath: string;
  content: string;
  modelId: string;
}

interface ParsedCodexTokenCountEvent {
  info: Record<string, unknown>;
}

interface ParsedClaudeUsageMessage {
  lineNumber: number;
  responseKey?: string;
  usage: unknown;
}

interface ParsedGeminiTokensPayload {
  location: string;
  tokens: unknown;
}

export async function extractChatUsageFromArtifact(
  options: ExtractChatUsageArtifactOptions,
): Promise<ChatUsageExtractionResult> {
  const { artifactPath, format, modelId, providerId } = options;
  let content: string;

  try {
    content = await readFile(artifactPath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return buildUnavailableResult({
        reason: "missing",
        artifactPath,
        format,
        providerId,
        modelId,
        message: "Chat usage artifact was not found.",
      });
    }

    return buildUnavailableResult({
      reason: "malformed",
      artifactPath,
      format,
      providerId,
      modelId,
      message: `Chat usage artifact could not be read: ${String(error)}`,
    });
  }

  const providerShape = PROVIDER_USAGE_SHAPE_MAPPINGS[providerId];
  if (!providerShape) {
    return buildUnavailableResult({
      reason: "unsupported_provider",
      artifactPath,
      format,
      providerId,
      modelId,
      message: `Usage extraction is not implemented for provider \`${providerId}\` yet.`,
    });
  }

  if (!isProviderArtifactFormatSupported(providerId, format)) {
    const providerLabel = formatProviderLabel(providerId);
    return buildUnavailableResult({
      reason: "unsupported_provider",
      artifactPath,
      format,
      providerId,
      modelId,
      message: `${providerLabel} usage extraction expects a ${providerShape.artifactFormat} artifact, received \`${format}\`.`,
    });
  }

  switch (providerId) {
    case "claude":
      return extractClaudeChatUsageFromJsonl({
        artifactPath,
        content,
        modelId,
      });
    case "codex":
      return extractCodexChatUsageFromJsonl({
        artifactPath,
        content,
        modelId,
      });
    case "gemini":
      return extractGeminiChatUsageFromJsonl({
        artifactPath,
        content,
        modelId,
      });
  }
}

export function extractCodexChatUsageFromJsonl(
  options: ExtractCodexChatUsageFromJsonlOptions,
): ChatUsageExtractionResult {
  const { artifactPath, content, modelId } = options;
  const tokenCountEvents: ParsedCodexTokenCountEvent[] = [];
  const lines = content.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed) as unknown;
    } catch (error) {
      return {
        status: "unavailable",
        reason: "malformed",
        provider: "codex",
        artifactPath,
        format: "jsonl",
        modelId,
        message: `Invalid JSONL at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const tokenCountEvent = parseCodexTokenCountEvent(parsedLine);
    if (tokenCountEvent) {
      tokenCountEvents.push(tokenCountEvent);
    }
  }

  if (tokenCountEvents.length === 0) {
    return buildUnavailableResult({
      reason: "missing",
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId,
      message: "No Codex token_count usage events were found in chat.jsonl.",
    });
  }

  const latestTokenCountEvent = tokenCountEvents.at(-1)!;

  const totalTokenUsage = asRecord(
    latestTokenCountEvent.info.total_token_usage,
  );
  if (!totalTokenUsage) {
    return buildUnavailableResult({
      reason: "malformed",
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId,
      message: "Codex token_count event is missing info.total_token_usage.",
    });
  }

  const usage = extractObservedProviderNativeUsage({
    providerId: "codex",
    usagePayload: totalTokenUsage,
  });
  if (!usage) {
    return buildUnavailableResult({
      reason: "malformed",
      artifactPath,
      format: "jsonl",
      providerId: "codex",
      modelId,
      message:
        "Codex token_count event did not contain any valid token usage fields.",
    });
  }

  return {
    status: "available",
    provider: "codex",
    artifactPath,
    format: "jsonl",
    modelId,
    tokenUsage: usage,
  };
}

export function extractClaudeChatUsageFromJsonl(
  options: ExtractClaudeChatUsageFromJsonlOptions,
): ChatUsageExtractionResult {
  const { artifactPath, content, modelId } = options;
  const usageMessages: ParsedClaudeUsageMessage[] = [];
  const lines = content.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed) as unknown;
    } catch (error) {
      return buildUnavailableResult({
        reason: "malformed",
        artifactPath,
        format: "jsonl",
        providerId: "claude",
        modelId,
        message: `Invalid JSONL at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }

    const usageMessage = parseClaudeUsageMessage(parsedLine, index + 1);
    if (usageMessage) {
      usageMessages.push(usageMessage);
    }
  }

  if (usageMessages.length === 0) {
    return buildUnavailableResult({
      reason: "missing",
      artifactPath,
      format: "jsonl",
      providerId: "claude",
      modelId,
      message: "No Claude message.usage payloads were found in chat.jsonl.",
    });
  }

  const normalizedUsage: ExtractedTokenUsage[] = [];
  const seenResponseKeys = new Set<string>();
  for (const usageMessage of usageMessages) {
    if (usageMessage.responseKey) {
      if (seenResponseKeys.has(usageMessage.responseKey)) {
        continue;
      }
      seenResponseKeys.add(usageMessage.responseKey);
    }

    const usageRecord = asRecord(usageMessage.usage);
    if (!usageRecord) {
      return buildUnavailableResult({
        reason: "malformed",
        artifactPath,
        format: "jsonl",
        providerId: "claude",
        modelId,
        message: `Claude message.usage at line ${usageMessage.lineNumber} is not an object.`,
      });
    }

    const usage = extractObservedProviderNativeUsage({
      providerId: "claude",
      usagePayload: usageRecord,
    });
    if (!usage) {
      return buildUnavailableResult({
        reason: "malformed",
        artifactPath,
        format: "jsonl",
        providerId: "claude",
        modelId,
        message: `Claude message.usage at line ${usageMessage.lineNumber} did not contain any valid token usage fields.`,
      });
    }

    normalizedUsage.push(usage);
  }

  const usage = sumExtractedUsage("claude", normalizedUsage);
  if (!usage) {
    return buildUnavailableResult({
      reason: "malformed",
      artifactPath,
      format: "jsonl",
      providerId: "claude",
      modelId,
      message:
        "Claude message.usage payloads did not contain any valid token usage fields.",
    });
  }

  return {
    status: "available",
    provider: "claude",
    artifactPath,
    format: "jsonl",
    modelId,
    tokenUsage: usage,
  };
}

export function extractGeminiChatUsageFromJsonl(
  options: ExtractGeminiChatUsageFromJsonlOptions,
): ChatUsageExtractionResult {
  const { artifactPath, content, modelId } = options;
  const tokensPayloadsByResponseId = new Map<
    string,
    ParsedGeminiTokensPayload
  >();
  const tokensPayloadsWithoutResponseId: ParsedGeminiTokensPayload[] = [];
  const lines = content.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed) as unknown;
    } catch (error) {
      return buildUnavailableResult({
        reason: "malformed",
        artifactPath,
        format: "jsonl",
        providerId: "gemini",
        modelId,
        message: `Invalid JSONL at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }

    const root = asRecord(parsedLine);
    if (!root || !("tokens" in root)) {
      continue;
    }

    const tokensPayload = {
      location: `line ${index + 1}.tokens`,
      tokens: root.tokens,
    };
    const responseId = typeof root.id === "string" ? root.id.trim() : "";
    if (responseId.length > 0) {
      tokensPayloadsByResponseId.set(responseId, tokensPayload);
    } else {
      tokensPayloadsWithoutResponseId.push(tokensPayload);
    }
  }

  const tokensPayloads = [
    ...tokensPayloadsWithoutResponseId,
    ...tokensPayloadsByResponseId.values(),
  ];
  if (tokensPayloads.length === 0) {
    return buildUnavailableResult({
      reason: "missing",
      artifactPath,
      format: "jsonl",
      providerId: "gemini",
      modelId,
      message: "No Gemini tokens payloads were found in chat.jsonl.",
    });
  }

  return extractGeminiTokenUsageFromPayloads({
    artifactPath,
    format: "jsonl",
    modelId,
    tokensPayloads,
  });
}

function extractGeminiTokenUsageFromPayloads(options: {
  artifactPath: string;
  format: ChatArtifactFormat;
  modelId: string;
  tokensPayloads: readonly ParsedGeminiTokensPayload[];
}): ChatUsageExtractionResult {
  const { artifactPath, format, modelId, tokensPayloads } = options;
  const normalizedUsage: ExtractedTokenUsage[] = [];
  for (const tokensPayload of tokensPayloads) {
    const tokensRecord = asRecord(tokensPayload.tokens);
    if (!tokensRecord) {
      return buildUnavailableResult({
        reason: "malformed",
        artifactPath,
        format,
        providerId: "gemini",
        modelId,
        message: `Gemini ${tokensPayload.location} is not an object.`,
      });
    }

    const usage = extractObservedProviderNativeUsage({
      providerId: "gemini",
      usagePayload: tokensRecord,
    });
    if (!usage) {
      return buildUnavailableResult({
        reason: "malformed",
        artifactPath,
        format,
        providerId: "gemini",
        modelId,
        message: `Gemini ${tokensPayload.location} did not contain any valid token usage fields.`,
      });
    }

    normalizedUsage.push(usage);
  }

  const usage = sumExtractedUsage("gemini", normalizedUsage);
  if (!usage) {
    return buildUnavailableResult({
      reason: "malformed",
      artifactPath,
      format,
      providerId: "gemini",
      modelId,
      message:
        "Gemini tokens payloads did not contain any valid token usage fields.",
    });
  }

  return {
    status: "available",
    provider: "gemini",
    artifactPath,
    format,
    modelId,
    tokenUsage: usage,
  };
}

function buildUnavailableResult(options: {
  reason: Exclude<
    TokenUsageUnavailableReason,
    "chat_not_captured" | "extractor_error"
  >;
  artifactPath: string;
  format: ChatArtifactFormat;
  providerId: ChatUsageProviderId;
  modelId: string;
  message: string;
}): ChatUsageExtractionResult {
  const { reason, artifactPath, format, providerId, modelId, message } =
    options;
  return {
    status: "unavailable",
    reason,
    provider: providerId,
    artifactPath,
    format,
    modelId,
    message,
  };
}

function parseCodexTokenCountEvent(
  value: unknown,
): ParsedCodexTokenCountEvent | undefined {
  const root = asRecord(value);
  if (root?.type !== "event_msg") {
    return undefined;
  }
  const payload = asRecord(root.payload);
  if (payload?.type !== "token_count") {
    return undefined;
  }

  const info = asRecord(payload.info);
  if (!info) {
    return undefined;
  }

  return { info };
}

function parseClaudeUsageMessage(
  value: unknown,
  lineNumber: number,
): ParsedClaudeUsageMessage | undefined {
  const root = asRecord(value);
  const message = asRecord(root?.message);
  if (!root || !message || !("usage" in message)) {
    return undefined;
  }

  return {
    lineNumber,
    responseKey: buildClaudeResponseKey(root, message),
    usage: message.usage,
  };
}

function buildClaudeResponseKey(
  root: Record<string, unknown>,
  message: Record<string, unknown>,
): string | undefined {
  const messageId = typeof message.id === "string" ? message.id.trim() : "";
  if (messageId.length === 0) {
    return undefined;
  }

  const requestId =
    typeof root.requestId === "string" ? root.requestId.trim() : "";
  return requestId.length > 0
    ? `request:${requestId}:message:${messageId}`
    : `message:${messageId}`;
}

function isProviderArtifactFormatSupported(
  providerId: ChatUsageProviderId,
  format: ChatArtifactFormat,
): boolean {
  const providerShape = PROVIDER_USAGE_SHAPE_MAPPINGS[providerId];
  return format === providerShape.artifactFormat;
}

function formatProviderLabel(providerId: ChatUsageProviderId): string {
  switch (providerId) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sumExtractedUsage(
  providerId: ChatUsageProviderId,
  usages: readonly ExtractedTokenUsage[],
): ExtractedTokenUsage | undefined {
  if (usages.length === 0) {
    return undefined;
  }

  const totals: Record<string, number> = {};
  const fieldMappings =
    PROVIDER_USAGE_SHAPE_MAPPINGS[providerId].billingRelevantFields;

  for (const fieldMapping of fieldMappings) {
    for (const usage of usages) {
      const usageRecord = asRecord(usage);
      const value = usageRecord?.[fieldMapping.usageFieldPath];
      if (typeof value !== "number") {
        continue;
      }

      totals[fieldMapping.usageFieldPath] =
        (totals[fieldMapping.usageFieldPath] ?? 0) + value;
    }
  }

  return extractObservedProviderNativeUsage({
    providerId,
    usagePayload: totals,
  });
}
