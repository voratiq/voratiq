import type { ToolAttachmentStatus } from "./model/types.js";

export const FIRST_PARTY_ATTACHED_LAUNCH_PROMPT =
  "Voratiq MCP tools are attached to this repository: voratiq_spec, voratiq_run, voratiq_reduce, voratiq_verify, voratiq_message, voratiq_list, and voratiq_apply. Your role is to orchestrate Voratiq workflows for the user through these tools. Use Voratiq tools for workflow state and actions unless explicitly instructed otherwise, preserving sessions and apply outcomes instead of switching to local edits, replacement stages, or manual apply paths; read voratiq://guide for the operating contract, discipline rules, workflow composition, and operator reference." as const;

export function resolveFirstPartyLaunchPrompt(
  toolAttachmentStatus: ToolAttachmentStatus,
): string | undefined {
  if (toolAttachmentStatus !== "attached") {
    return undefined;
  }

  return FIRST_PARTY_ATTACHED_LAUNCH_PROMPT;
}
