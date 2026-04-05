import type { ToolAttachmentStatus } from "./model/types.js";

export const FIRST_PARTY_ATTACHED_LAUNCH_PROMPT =
  "Context only. Do not respond to this message unless asked. Voratiq MCP tools are attached in this repo. For Voratiq session history and workflow actions, prefer the Voratiq MCP tools over bash, search, or direct file reads." as const;

export function resolveFirstPartyLaunchPrompt(
  toolAttachmentStatus: ToolAttachmentStatus,
): string | undefined {
  if (toolAttachmentStatus !== "attached") {
    return undefined;
  }

  return FIRST_PARTY_ATTACHED_LAUNCH_PROMPT;
}
