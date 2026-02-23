import type { TranscriptShellStyleOptions } from "./transcript-shell.js";
import {
  formatTranscriptBadge,
  resolveTranscriptShellStyle,
} from "./transcript-shell.js";

export type BadgeRenderOptions = TranscriptShellStyleOptions;

export function formatRunBadge(
  text: string,
  options: BadgeRenderOptions = {},
): string {
  return formatTranscriptBadge(
    text,
    "run",
    resolveTranscriptShellStyle(options),
  );
}

export function formatReviewBadge(
  text: string,
  options: BadgeRenderOptions = {},
): string {
  return formatTranscriptBadge(
    text,
    "review",
    resolveTranscriptShellStyle(options),
  );
}

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
