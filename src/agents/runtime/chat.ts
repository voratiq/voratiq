import { preserveProviderChatTranscripts } from "../../workspace/chat/artifacts.js";
import type { ChatArtifactFormat } from "../../workspace/chat/types.js";
import type { AgentRuntimeChatResult } from "./types.js";

export async function captureAgentChatArtifacts(options: {
  providerId: string | undefined;
  agentRoot: string;
}): Promise<AgentRuntimeChatResult> {
  const providerId = options.providerId ?? "";
  if (!providerId) {
    return { captured: false };
  }

  const result = await preserveProviderChatTranscripts({
    providerId,
    agentRoot: options.agentRoot,
  });

  const format: ChatArtifactFormat | undefined = result.format;
  if (
    (result.status === "captured" || result.status === "already-exists") &&
    format
  ) {
    return {
      captured: true,
      format,
      artifactPath: result.artifactPath,
      sourceCount: result.sourceCount,
    };
  }

  if (result.status === "not-found") {
    return { captured: false };
  }

  return {
    captured: false,
    error: result.status === "error" ? result.error : undefined,
  };
}
