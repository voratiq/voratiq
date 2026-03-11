import type { ExtractedTokenUsage } from "../../domains/runs/model/types.js";
import type { ChatArtifactFormat } from "./types.js";

export const TOKEN_USAGE_UNAVAILABLE_REASONS = [
  "chat_not_captured",
  "missing",
  "malformed",
  "unsupported_provider",
  "extractor_error",
] as const;

export type TokenUsageUnavailableReason =
  (typeof TOKEN_USAGE_UNAVAILABLE_REASONS)[number];

interface TokenUsageResultBase {
  provider: string;
  modelId: string;
  artifactPath?: string;
  format?: ChatArtifactFormat;
  message?: string;
}

export interface AvailableTokenUsageResult extends TokenUsageResultBase {
  status: "available";
  tokenUsage: ExtractedTokenUsage;
  reason?: undefined;
}

export interface UnavailableTokenUsageResult extends TokenUsageResultBase {
  status: "unavailable";
  reason: TokenUsageUnavailableReason;
  tokenUsage?: undefined;
}

export type TokenUsageResult =
  | AvailableTokenUsageResult
  | UnavailableTokenUsageResult;
