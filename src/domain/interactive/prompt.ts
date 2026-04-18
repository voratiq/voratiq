import type { ToolAttachmentStatus } from "./model/types.js";

export const FIRST_PARTY_ATTACHED_LAUNCH_PROMPT =
  "Voratiq MCP tools are attached to this repository: voratiq_spec, voratiq_run, voratiq_reduce, voratiq_verify, voratiq_message, voratiq_list, and voratiq_apply. For Voratiq session history and workflow actions, prefer these tools over bash, search, or direct file reads. Read the guide resource at voratiq://guide for the full operator reference, workflow composition, and usage guidance." as const;

export function resolveFirstPartyLaunchPrompt(
  toolAttachmentStatus: ToolAttachmentStatus,
): string | undefined {
  if (toolAttachmentStatus !== "attached") {
    return undefined;
  }

  return FIRST_PARTY_ATTACHED_LAUNCH_PROMPT;
}
