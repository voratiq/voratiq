import type { AgentDefinition } from "../../../configs/agents/types.js";
import { toErrorMessage } from "../../../utils/errors.js";
import { preserveProviderChatTranscripts } from "../../../workspace/chat/artifacts.js";
import type { ChatArtifactFormat } from "../../../workspace/chat/types.js";
import { AgentRunContext } from "./run-context.js";

export interface CaptureChatOptions {
  agent: AgentDefinition;
  agentContext: AgentRunContext;
  agentRoot: string;
  reason?: string;
}

export async function captureAgentChatTranscripts(
  options: CaptureChatOptions,
): Promise<void> {
  const providerId = options.agent.provider;
  if (!providerId) {
    return;
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
    options.agentContext.markChatArtifact(format);
    if (
      result.status === "captured" &&
      format === "json" &&
      (result.sourceCount ?? 0) > 1
    ) {
      // Intentionally silent: avoid noisy warnings during routine runs.
    }
    return;
  }

  if (result.status === "not-found") {
    return;
  }

  if (result.status === "error") {
    throw new Error(
      formatChatWarning(
        options,
        `Failed to preserve ${providerId} transcripts: ${toErrorMessage(result.error)}`,
      ),
    );
  }
}

function formatChatWarning(
  options: CaptureChatOptions,
  message: string,
): string {
  const prefix = options.reason
    ? `[voratiq] (${options.agent.id}, ${options.reason})`
    : `[voratiq] (${options.agent.id})`;
  return `${prefix} ${message}`;
}
