import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { formatAgentErrorLine } from "../utils/agents.js";
import { formatDurationLabel } from "../utils/agents.js";
import { formatAgentBadge } from "../utils/badges.js";
import { formatRunTimestamp } from "../utils/records.js";
import {
  buildStageFrameLines,
  buildStageFrameSections,
} from "../utils/stage-output.js";
import { renderTranscript } from "../utils/transcript.js";
import type { TranscriptShellStyleOptions } from "../utils/transcript-shell.js";
import {
  buildTranscriptShellSection,
  formatTranscriptStatusLabel,
  renderTranscriptStatusTable,
  resolveTranscriptShellStyle,
} from "../utils/transcript-shell.js";
import type { StageProgressEventConsumer } from "./stage-progress.js";

type CliWriter = Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };

export interface ReviewProgressContext {
  runId: string;
  reviewId: string;
  createdAt: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed" | "aborted";
}

export interface ReviewProgressReviewerRecord {
  reviewerAgentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  startedAt?: string;
  completedAt?: string;
}

interface ReviewRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

export interface ReviewProgressRenderer
  extends StageProgressEventConsumer<
    ReviewProgressContext,
    ReviewProgressReviewerRecord
  > {
  begin(context?: ReviewProgressContext): void;
  update(record: ReviewProgressReviewerRecord): void;
  complete(status?: ReviewProgressContext["status"]): void;
}

const ERASE_LINE = "\u001b[2K";
const CURSOR_COLUMN_START = "\u001b[0G";
const DASH = "—";

function cursorUp(lines: number): string {
  return `\u001b[${lines}F`;
}

function formatErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error === null || error === undefined) {
    return "unknown error";
  }

  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return `${error}`;
  }

  if (typeof error === "symbol") {
    return error.description ?? error.toString();
  }

  if (typeof error === "object") {
    try {
      const serialized = JSON.stringify(error);
      if (serialized) {
        return serialized;
      }
    } catch {
      // Ignore serialization errors and fall back.
    }
  }

  return "unknown error";
}

function buildReviewStageShell(options: {
  runId: string;
  reviewId: string;
  createdAt: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  elapsed: string;
  tableLines?: string[];
  style?: TranscriptShellStyleOptions;
}): {
  metadataLines: string[];
  statusTableLines: string[];
} {
  const style = options.style ?? {};
  return {
    metadataLines: buildTranscriptShellSection({
      badgeText: options.reviewId,
      badgeVariant: "review",
      status: {
        value: options.status,
        color: getRunStatusStyle(options.status).cli,
      },
      detailRows: [
        { label: "Elapsed", value: options.elapsed },
        { label: "Created", value: formatRunTimestamp(options.createdAt) },
        { label: "Run", value: options.runId },
        { label: "Workspace", value: options.workspacePath },
      ],
      style,
    }),
    statusTableLines: options.tableLines ?? [],
  };
}

export function createReviewRenderer(
  options: ReviewRendererOptions = {},
): ReviewProgressRenderer {
  const stdout: CliWriter = options.stdout ?? process.stdout;
  const stderr: CliWriter = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now.bind(Date);
  const suppressLeadingBlankLine = options.suppressLeadingBlankLine === true;
  const suppressTrailingBlankLine = options.suppressTrailingBlankLine === true;

  let context: ReviewProgressContext | undefined;
  let disabled = false;
  let warningLogged = false;
  let blockInitialized = false;
  let lastRenderedLines = 0;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;

  const reviewerOrder: string[] = [];
  const reviewerRecords = new Map<string, ReviewProgressReviewerRecord>();

  function stopRefreshLoop(): void {
    if (!refreshInterval) {
      return;
    }

    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }

  function hasRunningReviewers(): boolean {
    for (const reviewer of reviewerRecords.values()) {
      if (reviewer.status === "running") {
        return true;
      }
    }
    return false;
  }

  function syncRefreshLoop(): void {
    if (!stdout.isTTY || disabled || !context || !hasRunningReviewers()) {
      stopRefreshLoop();
      return;
    }

    if (refreshInterval) {
      return;
    }

    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context || !hasRunningReviewers()) {
          stopRefreshLoop();
          return;
        }

        const nextElapsed = formatReviewElapsed(context.createdAt);
        if (nextElapsed === lastElapsedLabel) {
          return;
        }

        render();
      });
    }, 1000);
    refreshInterval.unref?.();
  }

  function guard(action: () => void): void {
    if (disabled) {
      return;
    }
    try {
      action();
    } catch (error) {
      disabled = true;
      stopRefreshLoop();
      if (!warningLogged) {
        warningLogged = true;
        stderr.write(
          `[voratiq] Progressive review output disabled: ${formatErrorDetail(error)}\n`,
        );
      }
    }
  }

  function formatReviewElapsed(createdAt: string): string | undefined {
    const startedAt = Date.parse(createdAt);
    if (Number.isNaN(startedAt)) {
      return undefined;
    }

    return formatDurationLabel(Math.max(0, now() - startedAt));
  }

  function safeParse(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return parsed;
  }

  function formatDuration(record: ReviewProgressReviewerRecord): string {
    const startedAt = safeParse(record.startedAt);
    if (startedAt === undefined) {
      return DASH;
    }

    const completedAt = safeParse(record.completedAt);
    if (completedAt === undefined || completedAt < startedAt) {
      return DASH;
    }

    return formatDurationLabel(completedAt - startedAt) ?? DASH;
  }

  function buildReviewerTable(style: TranscriptShellStyleOptions): string[] {
    if (reviewerRecords.size === 0) {
      return [];
    }

    const resolvedStyle = resolveTranscriptShellStyle(style);
    const rows = reviewerOrder
      .filter((reviewerId) => reviewerRecords.has(reviewerId))
      .map((reviewerId) => {
        const reviewer = reviewerRecords.get(reviewerId)!;
        return {
          reviewerAgentId: formatAgentBadge(reviewer.reviewerAgentId, style),
          status: formatTranscriptStatusLabel(
            reviewer.status,
            getAgentStatusStyle(reviewer.status).cli,
            resolvedStyle,
          ),
          duration: formatDuration(reviewer),
        };
      });

    return renderTranscriptStatusTable({
      rows,
      agent: (row) => row.reviewerAgentId,
      status: (row) => row.status,
      duration: (row) => row.duration,
    });
  }

  function render(): void {
    if (!context || disabled || !stdout.isTTY) {
      return;
    }

    const style: TranscriptShellStyleOptions = { isTty: true };
    const elapsed = formatReviewElapsed(context.createdAt);
    lastElapsedLabel = elapsed ?? null;

    const shell = buildReviewStageShell({
      runId: context.runId,
      reviewId: context.reviewId,
      createdAt: context.createdAt,
      workspacePath: context.workspacePath,
      status: context.status,
      elapsed: elapsed ?? DASH,
      tableLines: buildReviewerTable(style),
      style,
    });
    const interactiveLines = buildStageFrameLines({
      metadataLines: shell.metadataLines,
      statusTableLines: shell.statusTableLines,
      leadingBlankLine: !suppressLeadingBlankLine,
      trailingBlankLine: !suppressTrailingBlankLine,
    });

    if (interactiveLines.length === 0) {
      return;
    }

    if (!blockInitialized) {
      stdout.write(interactiveLines.join("\n"));
      lastRenderedLines = interactiveLines.length;
      blockInitialized = true;
      return;
    }

    const linesToRewind = Math.max(0, lastRenderedLines - 1);
    if (linesToRewind > 0) {
      stdout.write(cursorUp(linesToRewind));
    }
    stdout.write(CURSOR_COLUMN_START);

    const totalLines = Math.max(lastRenderedLines, interactiveLines.length);
    const rewrittenLines: string[] = [];
    for (let index = 0; index < totalLines; index += 1) {
      const line = interactiveLines[index] ?? "";
      rewrittenLines.push(CURSOR_COLUMN_START, ERASE_LINE, line);
      if (index < totalLines - 1) {
        rewrittenLines.push("\n");
      }
    }

    stdout.write(rewrittenLines.join(""));
    lastRenderedLines = totalLines;
  }

  function upsertReviewer(record: ReviewProgressReviewerRecord): void {
    if (!reviewerOrder.includes(record.reviewerAgentId)) {
      reviewerOrder.push(record.reviewerAgentId);
    }
    const existing = reviewerRecords.get(record.reviewerAgentId);
    reviewerRecords.set(record.reviewerAgentId, {
      ...existing,
      ...record,
      startedAt: record.startedAt ?? existing?.startedAt,
      completedAt: record.completedAt ?? existing?.completedAt,
    });
  }

  return {
    onProgressEvent(event): void {
      guard(() => {
        if (event.stage !== "review") {
          return;
        }

        if (event.type === "stage.begin") {
          context = { ...event.context };
          render();
          syncRefreshLoop();
          return;
        }

        if (event.type === "stage.candidate") {
          upsertReviewer(event.candidate);
          render();
          syncRefreshLoop();
          return;
        }

        if (!context) {
          return;
        }

        context = {
          ...context,
          status: event.status as ReviewProgressContext["status"],
        };
        render();
        syncRefreshLoop();
      });
    },
    begin(nextContext?: ReviewProgressContext): void {
      guard(() => {
        if (!nextContext) {
          render();
          syncRefreshLoop();
          return;
        }
        this.onProgressEvent({
          type: "stage.begin",
          stage: "review",
          context: nextContext,
        });
      });
    },
    update(record: ReviewProgressReviewerRecord): void {
      this.onProgressEvent({
        type: "stage.candidate",
        stage: "review",
        candidate: record,
      });
    },
    complete(status?: ReviewProgressContext["status"]): void {
      stopRefreshLoop();
      guard(() => {
        if (status) {
          this.onProgressEvent({
            type: "stage.status",
            stage: "review",
            status,
          });
        } else {
          render();
        }

        disabled = true;
      });
    },
  };
}

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
  recommendedAgentId?: string;
  suppressHint?: boolean;
  isTty?: boolean;
  includeSummarySection?: boolean;
}): string {
  const {
    runId,
    reviewId,
    createdAt,
    elapsed,
    workspacePath,
    status,
    reviewers,
    recommendedAgentId,
    suppressHint,
    isTty,
    includeSummarySection = true,
  } = options;

  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);

  const sections: string[][] = [];
  if (includeSummarySection) {
    const summaryShell = buildReviewStageShell({
      runId,
      reviewId,
      createdAt,
      workspacePath,
      status,
      elapsed,
      tableLines:
        reviewers.length > 0
          ? renderTranscriptStatusTable({
              rows: reviewers,
              agent: (row) => row.reviewerAgentId,
              status: (row) =>
                formatTranscriptStatusLabel(
                  row.status,
                  getAgentStatusStyle(row.status).cli,
                  resolvedStyle,
                ),
              duration: (row) => row.duration,
            })
          : [],
      style,
    });
    sections.push(...buildStageFrameSections(summaryShell));
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
        message: `---\n\nTo apply a solution:\n  voratiq apply --run ${runId} --agent ${recommendedAgentId ?? "<agent-id>"}`,
      };

  return renderTranscript({ sections, hint });
}
