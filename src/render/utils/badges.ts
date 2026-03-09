import type { TranscriptShellStyleOptions } from "./transcript-shell.js";
import {
  formatTranscriptBadge,
  resolveTranscriptShellStyle,
} from "./transcript-shell.js";

export type BadgeRenderOptions = TranscriptShellStyleOptions;

export function formatAgentBadge(
  text: string,
  options: BadgeRenderOptions = {},
): string {
  return formatTranscriptBadge(
    text,
    "agent",
    resolveTranscriptShellStyle(options),
  );
}
