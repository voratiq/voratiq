import type { AutoTerminalStatus } from "../../domain/run/model/types.js";
import { getRunStatusStyle } from "../../status/colors.js";
import type { RunStatus } from "../../status/index.js";
import { colorize } from "../../utils/colors.js";
import { formatDurationLabel } from "../utils/duration.js";
import { renderTranscript } from "../utils/transcript.js";

export type AutoPhaseStatus = "succeeded" | "failed" | "aborted" | "skipped";

export interface AutoPhaseSummary {
  status: AutoPhaseStatus;
  durationMs?: number;
  detail?: string;
}

export interface AutoSummaryInput {
  status: AutoTerminalStatus;
  totalDurationMs: number;
  spec: AutoPhaseSummary & { specPath?: string };
  run: AutoPhaseSummary & {
    runId?: string;
    runStatus?: RunStatus;
    createdAt?: string;
    specPath?: string;
    baseRevisionSha?: string;
  };
  verify: AutoPhaseSummary;
  apply?: AutoPhaseSummary & { agentId?: string };
}

export function renderAutoSummaryTranscript(input: AutoSummaryInput): string {
  const totalDuration = formatDurationLabel(input.totalDurationMs) ?? "—";
  const statusLabel =
    input.status === "action_required"
      ? "ACTION_REQUIRED"
      : input.status === "succeeded"
        ? "SUCCEEDED"
        : input.status === "aborted"
          ? "ABORTED"
          : "FAILED";
  const statusStyle =
    input.status === "action_required"
      ? { cli: "yellow" as const }
      : getRunStatusStyle(
          (input.status === "succeeded"
            ? "succeeded"
            : input.status === "aborted"
              ? "aborted"
              : "failed") satisfies RunStatus,
        );
  const lines: string[] = [
    `Auto ${colorize(statusLabel, statusStyle.cli)} (${totalDuration})`,
  ];
  return renderTranscript({ sections: [lines] });
}
