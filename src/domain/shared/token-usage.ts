import type { TokenUsageResult } from "../../workspace/chat/token-usage-result.js";
import type { ChatArtifactFormat } from "../../workspace/chat/types.js";
import type { ExtractedTokenUsage } from "../run/model/types.js";

export const DEFAULT_TOKEN_USAGE_UNAVAILABLE_MESSAGE =
  "Chat usage capture was not enabled or did not produce an artifact.";
export const UNKNOWN_TOKEN_USAGE_PROVIDER = "unknown";
export const UNKNOWN_TOKEN_USAGE_MODEL_ID = "unknown";

interface TokenUsageResultMetadata {
  provider?: string;
  modelId?: string;
  artifactPath?: string;
  format?: ChatArtifactFormat;
}

export function buildUnavailableTokenUsageResult(
  options: TokenUsageResultMetadata & {
    message?: string;
  },
): TokenUsageResult {
  const {
    provider = UNKNOWN_TOKEN_USAGE_PROVIDER,
    modelId = UNKNOWN_TOKEN_USAGE_MODEL_ID,
    artifactPath,
    format,
    message,
  } = options;

  return {
    status: "unavailable",
    reason: "chat_not_captured",
    provider,
    modelId,
    ...(artifactPath !== undefined ? { artifactPath } : {}),
    ...(format !== undefined ? { format } : {}),
    message: message ?? DEFAULT_TOKEN_USAGE_UNAVAILABLE_MESSAGE,
  };
}

export function resolveTokenUsage(
  result: TokenUsageResult,
): ExtractedTokenUsage | undefined {
  return result.status === "available" ? result.tokenUsage : undefined;
}

export function reconstructTokenUsageResult(
  options: TokenUsageResultMetadata & {
    tokenUsage?: ExtractedTokenUsage;
    message?: string;
  },
): TokenUsageResult {
  const {
    tokenUsage,
    provider = UNKNOWN_TOKEN_USAGE_PROVIDER,
    modelId = UNKNOWN_TOKEN_USAGE_MODEL_ID,
    artifactPath,
    format,
    message,
  } = options;

  if (!tokenUsage) {
    return buildUnavailableTokenUsageResult({
      provider,
      modelId,
      artifactPath,
      format,
      message,
    });
  }

  return {
    status: "available",
    provider,
    modelId,
    ...(artifactPath !== undefined ? { artifactPath } : {}),
    ...(format !== undefined ? { format } : {}),
    tokenUsage,
  };
}
