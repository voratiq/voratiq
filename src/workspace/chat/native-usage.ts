import type { ChatUsageProviderId } from "../../domain/run/model/types.js";
import { resolvePath } from "../../utils/path.js";
import { getAgentSessionChatArtifactPath } from "../artifact-paths.js";
import type { TokenUsageResult } from "./token-usage-result.js";
import type { ChatArtifactFormat } from "./types.js";
import { extractChatUsageFromArtifact } from "./usage-extractor.js";

export async function extractProviderNativeTokenUsageForSession(options: {
  root: string;
  domain: string;
  sessionId: string;
  agentId: string;
  provider: string;
  modelId: string;
  chatCaptured: boolean;
  format?: ChatArtifactFormat;
  artifactPath?: string;
}): Promise<TokenUsageResult> {
  const {
    root,
    domain,
    sessionId,
    agentId,
    provider,
    modelId,
    chatCaptured,
    format,
    artifactPath,
  } = options;

  if (!chatCaptured || !format) {
    return {
      status: "unavailable",
      reason: "chat_not_captured",
      provider,
      modelId,
      artifactPath,
      format,
      message:
        "Chat usage capture was not enabled or did not produce an artifact.",
    };
  }

  const providerId = toChatUsageProviderId(provider);
  if (!providerId) {
    return {
      status: "unavailable",
      reason: "unsupported_provider",
      provider,
      modelId,
      artifactPath,
      format,
      message: `Usage extraction is not implemented for provider \`${provider}\` yet.`,
    };
  }

  const resolvedArtifactPath =
    artifactPath ??
    resolvePath(
      root,
      getAgentSessionChatArtifactPath(domain, sessionId, agentId, format),
    );

  try {
    return await extractChatUsageFromArtifact({
      artifactPath: resolvedArtifactPath,
      format,
      providerId,
      modelId,
    });
  } catch (error) {
    return {
      status: "unavailable",
      reason: "extractor_error",
      provider,
      modelId,
      artifactPath: resolvedArtifactPath,
      format,
      message: `Chat usage extraction failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function toChatUsageProviderId(value: string): ChatUsageProviderId | undefined {
  switch (value) {
    case "claude":
    case "codex":
    case "gemini":
      return value;
    default:
      return undefined;
  }
}
