import {
  type ChatUsageProviderId,
  type ExtractedTokenUsage,
  extractedTokenUsageSchemaByProvider,
} from "../../domain/run/model/types.js";
import type { ChatArtifactFormat } from "./types.js";

export interface ProviderUsageFieldMapping {
  artifactFieldPath: string;
  usageFieldPath: string;
}

export interface ProviderUsageShapeMapping {
  providerId: ChatUsageProviderId;
  artifactFormat: ChatArtifactFormat;
  artifactShape: string;
  usageRootPath: string;
  billingRelevantFields: readonly ProviderUsageFieldMapping[];
}

export const PROVIDER_USAGE_SHAPE_MAPPINGS: Record<
  ChatUsageProviderId,
  ProviderUsageShapeMapping
> = {
  claude: {
    providerId: "claude",
    artifactFormat: "jsonl",
    artifactShape: "message.usage",
    usageRootPath: "usage",
    billingRelevantFields: [
      {
        artifactFieldPath: "usage.input_tokens",
        usageFieldPath: "input_tokens",
      },
      {
        artifactFieldPath: "usage.output_tokens",
        usageFieldPath: "output_tokens",
      },
      {
        artifactFieldPath: "usage.cache_read_input_tokens",
        usageFieldPath: "cache_read_input_tokens",
      },
      {
        artifactFieldPath: "usage.cache_creation_input_tokens",
        usageFieldPath: "cache_creation_input_tokens",
      },
    ],
  },
  codex: {
    providerId: "codex",
    artifactFormat: "jsonl",
    artifactShape: "event_msg(type=token_count).info.total_token_usage",
    usageRootPath: "event_msg.info.total_token_usage",
    billingRelevantFields: [
      {
        artifactFieldPath: "event_msg.info.total_token_usage.input_tokens",
        usageFieldPath: "input_tokens",
      },
      {
        artifactFieldPath:
          "event_msg.info.total_token_usage.cached_input_tokens",
        usageFieldPath: "cached_input_tokens",
      },
      {
        artifactFieldPath: "event_msg.info.total_token_usage.output_tokens",
        usageFieldPath: "output_tokens",
      },
      {
        artifactFieldPath:
          "event_msg.info.total_token_usage.reasoning_output_tokens",
        usageFieldPath: "reasoning_output_tokens",
      },
      {
        artifactFieldPath: "event_msg.info.total_token_usage.total_tokens",
        usageFieldPath: "total_tokens",
      },
    ],
  },
  gemini: {
    providerId: "gemini",
    artifactFormat: "json",
    artifactShape: "transcript.tokens",
    usageRootPath: "tokens",
    billingRelevantFields: [
      {
        artifactFieldPath: "tokens.input",
        usageFieldPath: "input",
      },
      {
        artifactFieldPath: "tokens.output",
        usageFieldPath: "output",
      },
      {
        artifactFieldPath: "tokens.cached",
        usageFieldPath: "cached",
      },
      {
        artifactFieldPath: "tokens.thoughts",
        usageFieldPath: "thoughts",
      },
      {
        artifactFieldPath: "tokens.tool",
        usageFieldPath: "tool",
      },
      {
        artifactFieldPath: "tokens.total",
        usageFieldPath: "total",
      },
    ],
  },
};

interface ExtractObservedProviderNativeUsageOptions {
  providerId: ChatUsageProviderId;
  usagePayload: unknown;
}

export function extractObservedProviderNativeUsage(
  options: ExtractObservedProviderNativeUsageOptions,
): ExtractedTokenUsage | undefined {
  const mapping = PROVIDER_USAGE_SHAPE_MAPPINGS[options.providerId];
  const usageRecord = asRecord(options.usagePayload);
  if (!usageRecord) {
    return undefined;
  }

  const nativeUsage: Record<string, number> = {};
  for (const fieldMapping of mapping.billingRelevantFields) {
    const value = getPathValue(usageRecord, fieldMapping.usageFieldPath);
    const tokenCount = normalizeTokenCount(value);
    if (tokenCount !== undefined) {
      nativeUsage[fieldMapping.usageFieldPath] = tokenCount;
    }
  }

  if (Object.keys(nativeUsage).length === 0) {
    return undefined;
  }

  const parsed =
    extractedTokenUsageSchemaByProvider[options.providerId].safeParse(
      nativeUsage,
    );
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getPathValue(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const segment of path.split(".")) {
    const currentRecord = asRecord(current);
    if (!currentRecord || !(segment in currentRecord)) {
      return undefined;
    }
    current = currentRecord[segment];
  }
  return current;
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return undefined;
  }
  return value;
}
