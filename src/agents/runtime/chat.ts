import { collectProviderArtifacts } from "../launch/chat.js";
import type { AgentRuntimeChatResult } from "./types.js";

export async function captureAgentChatArtifacts(options: {
  providerId: string | undefined;
  agentRoot: string;
}): Promise<AgentRuntimeChatResult> {
  return await collectProviderArtifacts({
    providerId: options.providerId,
    sessionRoot: options.agentRoot,
  });
}
