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
  totalDurationMs: number;
  spec: AutoPhaseSummary & { outputPath?: string };
  run: AutoPhaseSummary & {
    runId?: string;
    runStatus?: RunStatus;
    createdAt?: string;
    specPath?: string;
    baseRevisionSha?: string;
  };
  review: AutoPhaseSummary & { outputPath?: string };
}

export function renderAutoSummaryTranscript(input: AutoSummaryInput): string {
  const totalDuration = formatDurationLabel(input.totalDurationMs) ?? "—";
  const autoSucceeded =
    input.spec.status !== "failed" &&
    input.run.status !== "failed" &&
    input.review.status !== "failed";
  const runStatus: RunStatus = autoSucceeded ? "succeeded" : "failed";
  const statusLabel = autoSucceeded ? "SUCCEEDED" : "FAILED";
  const statusStyle = getRunStatusStyle(runStatus);
  const lines: string[] = [
    `Auto ${colorize(statusLabel, statusStyle.cli)} (${totalDuration})`,
  ];
  return renderTranscript({ sections: [lines] });
}
