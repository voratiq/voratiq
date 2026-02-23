import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { formatAgentErrorLine } from "../utils/agents.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTranscript } from "../utils/transcript.js";
import type { TranscriptShellStyleOptions } from "../utils/transcript-shell.js";
import {
  buildTranscriptShellSection,
  formatTranscriptStatusLabel,
  renderTranscriptStatusTable,
  resolveTranscriptShellStyle,
} from "../utils/transcript-shell.js";

interface ReviewTranscriptReviewerBlock {
  reviewerAgentId: string;
  outputPath: string;
  duration: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  previewLines?: readonly string[];
  errorLine?: string;
}

export function renderReviewTranscript(options: {
  runId: string;
  reviewId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  reviewers: readonly ReviewTranscriptReviewerBlock[];
  suppressHint?: boolean;
  isTty?: boolean;
}): string {
  const {
    runId,
    reviewId,
    createdAt,
    elapsed,
    workspacePath,
    status,
    reviewers,
    suppressHint,
    isTty,
  } = options;

  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);

  const sections: string[][] = [];
  sections.push(
    buildTranscriptShellSection({
      badgeText: reviewId,
      badgeVariant: "review",
      status: { value: status, color: getRunStatusStyle(status).cli },
      detailRows: [
        { label: "Elapsed", value: elapsed },
        { label: "Created", value: formatRunTimestamp(createdAt) },
        { label: "Run", value: runId },
        { label: "Workspace", value: workspacePath },
      ],
      style,
    }),
  );

  if (reviewers.length > 0) {
    sections.push(
      renderTranscriptStatusTable({
        rows: reviewers,
        agent: (row) => row.reviewerAgentId,
        status: (row) =>
          formatTranscriptStatusLabel(
            row.status,
            getAgentStatusStyle(row.status).cli,
            resolvedStyle,
          ),
        duration: (row) => row.duration,
      }),
    );
  }

  if (reviewers.length > 0) {
    sections.push(["---"]);
  }

  reviewers.forEach((reviewer, index) => {
    const block: string[] = [`Reviewer: ${reviewer.reviewerAgentId}`];
    if (reviewer.previewLines && reviewer.previewLines.length > 0) {
      block.push("", ...reviewer.previewLines);
    }
    if (reviewer.errorLine) {
      const inlineError = reviewer.errorLine.replace(/\s+/g, " ").trim();
      block.push("", formatAgentErrorLine(inlineError, style));
    }
    if (reviewer.outputPath && reviewer.status === "succeeded") {
      block.push("", `Review: ${reviewer.outputPath}`);
    }
    if (index < reviewers.length - 1) {
      block.push("", "---");
    }
    sections.push(block);
  });

  const hint = suppressHint
    ? undefined
    : {
        message: `---\n\nTo apply a solution:\n    voratiq apply --run ${runId} --agent <agent-id>`,
      };

  return renderTranscript({ sections, hint });
}
