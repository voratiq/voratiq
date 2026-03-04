import type { AutoTerminalStatus } from "../../runs/records/types.js";
import { getRunStatusStyle } from "../../status/colors.js";
import type { RunStatus } from "../../status/index.js";
import { colorize } from "../../utils/colors.js";
import { formatDurationLabel } from "../utils/agents.js";
import { renderTranscript } from "../utils/transcript.js";

export type AutoPhaseStatus = "succeeded" | "failed" | "skipped";

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
  review: AutoPhaseSummary & { outputPath?: string };
  apply?: AutoPhaseSummary & { agentId?: string };
}

function formatAutoPhaseStatus(status: AutoPhaseStatus): string {
  if (status === "succeeded") {
    return colorize("SUCCEEDED", getRunStatusStyle("succeeded").cli);
  }
  if (status === "failed") {
    return colorize("FAILED", getRunStatusStyle("failed").cli);
  }
  return colorize("SKIPPED", "yellow");
}

export function renderAutoSummaryTranscript(input: AutoSummaryInput): string {
  const totalDuration = formatDurationLabel(input.totalDurationMs) ?? "—";
  const statusLabel =
    input.status === "action_required"
      ? "ACTION REQUIRED"
      : input.status === "succeeded"
        ? "SUCCEEDED"
        : "FAILED";
  const statusStyle =
    input.status === "action_required"
      ? { cli: "yellow" as const }
      : getRunStatusStyle(
          (input.status === "succeeded"
            ? "succeeded"
            : "failed") satisfies RunStatus,
        );
  const lines: string[] = [
    `Auto ${colorize(statusLabel, statusStyle.cli)} (${totalDuration})`,
    `spec: ${formatAutoPhaseStatus(input.spec.status)}`,
    `run: ${formatAutoPhaseStatus(input.run.status)}`,
    `review: ${formatAutoPhaseStatus(input.review.status)}`,
    `apply: ${formatAutoPhaseStatus(input.apply?.status ?? "skipped")}`,
  ];
  return renderTranscript({ sections: [lines] });
}
