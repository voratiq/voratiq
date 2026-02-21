import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatAgentErrorLine } from "../utils/agents.js";
import { formatReviewBadge } from "../utils/badges.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";

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
  } = options;

  const sections: string[][] = [];
  sections.push([
    `${formatReviewBadge(reviewId)} ${colorize(
      status.toUpperCase(),
      getRunStatusStyle(status).cli,
    )}`,
  ]);
  sections.push([
    ...buildDetailRows([
      ["Elapsed", elapsed],
      ["Created", formatRunTimestamp(createdAt)],
      ["Run", runId],
      ["Workspace", workspacePath],
    ]),
  ]);

  if (reviewers.length > 0) {
    sections.push(
      renderTable({
        columns: [
          { header: "AGENT", accessor: (row) => row.reviewerAgentId },
          { header: "STATUS", accessor: (row) => row.statusLabel },
          { header: "DURATION", accessor: (row) => row.duration },
        ],
        rows: reviewers.map((reviewer) => ({
          reviewerAgentId: reviewer.reviewerAgentId,
          statusLabel: colorize(
            reviewer.status.toUpperCase(),
            getAgentStatusStyle(reviewer.status).cli,
          ),
          duration: reviewer.duration,
        })),
      }),
    );
  }

  if (reviewers.length > 0) {
    sections.push(["---"]);
  }

  reviewers.forEach((reviewer, index) => {
    const failed =
      reviewer.status === "failed" || reviewer.status === "aborted";
    const block: string[] = [
      failed
        ? `Reviewer: ${reviewer.reviewerAgentId} ${reviewer.status.toUpperCase()}`
        : `Reviewer: ${reviewer.reviewerAgentId}`,
    ];
    if (reviewer.previewLines && reviewer.previewLines.length > 0) {
      block.push("", ...reviewer.previewLines);
    }
    if (reviewer.errorLine) {
      const inlineError = reviewer.errorLine.replace(/\s+/g, " ").trim();
      block.push("", formatAgentErrorLine(inlineError));
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

function buildDetailRows(rows: Array<[string, string]>): string[] {
  const detailRows = rows.map(([label, value]) => ({ label, value }));
  const tableLines = renderTable({
    columns: [
      {
        header: "FIELD",
        accessor: (row: (typeof detailRows)[number]) => row.label,
      },
      {
        header: "VALUE",
        accessor: (row: (typeof detailRows)[number]) => row.value,
      },
    ],
    rows: detailRows,
  });
  const [, ...body] = tableLines;
  return body;
}
