import type { ExtractedTokenUsage } from "../../domains/runs/model/types.js";
import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { TERMINAL_REDUCTION_STATUSES } from "../../status/index.js";
import type { TokenUsageResult } from "../../workspace/chat/token-usage-result.js";
import { formatAgentErrorLine } from "../utils/agents.js";
import { formatRenderLifecycleDuration } from "../utils/duration.js";
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

export interface ReduceProgressContext {
  reductionId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  sourceLabel: "Spec" | "Run" | "Review" | "Reduce";
  sourcePath: string;
  workspacePath: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
}

export interface ReduceProgressReducerRecord {
  reducerAgentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  startedAt?: string;
  completedAt?: string;
  tokenUsage?: ExtractedTokenUsage;
  tokenUsageResult?: TokenUsageResult;
}

interface ReduceRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

export interface ReduceProgressRenderer
  extends StageProgressEventConsumer<
    ReduceProgressContext,
    ReduceProgressReducerRecord
  > {
  begin(context?: ReduceProgressContext): void;
  update(record: ReduceProgressReducerRecord): void;
  complete(
    status?: ReduceProgressContext["status"],
    lifecycle?: { startedAt?: string; completedAt?: string },
  ): void;
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

export interface ReduceTranscriptReducerBlock {
  reducerAgentId: string;
  status: "queued" | "succeeded" | "failed" | "aborted" | "running";
  duration: string;
  outputPath: string;
  dataPath?: string;
  previewLines?: string[];
  errorLine?: string;
}

export interface ReduceTranscriptOptions {
  reductionId: string;
  createdAt: string;
  elapsed: string;
  sourceLabel: "Spec" | "Run" | "Review" | "Reduce";
  sourcePath: string;
  workspacePath: string;
  status: "queued" | "succeeded" | "failed" | "aborted" | "running";
  reducers: readonly ReduceTranscriptReducerBlock[];
  nextCommandLines?: readonly string[];
  suppressHint?: boolean;
  isTty?: boolean;
  includeSummarySection?: boolean;
}

function buildReduceStageShell(options: {
  reductionId: string;
  createdAt: string;
  elapsed: string;
  sourceLabel: string;
  sourcePath: string;
  workspacePath: string;
  status: "queued" | "succeeded" | "failed" | "aborted" | "running";
  tableLines?: string[];
  style?: TranscriptShellStyleOptions;
}): {
  metadataLines: string[];
  statusTableLines: string[];
} {
  return {
    metadataLines: buildTranscriptShellSection({
      badgeText: options.reductionId,
      badgeVariant: "reduce",
      status: {
        value: options.status,
        color: getRunStatusStyle(options.status).cli,
      },
      detailRows: [
        { label: "Elapsed", value: options.elapsed },
        { label: "Created", value: formatRunTimestamp(options.createdAt) },
        { label: options.sourceLabel, value: options.sourcePath },
        { label: "Workspace", value: options.workspacePath },
      ],
      style: options.style,
    }),
    statusTableLines: options.tableLines ?? [],
  };
}

export function createReduceRenderer(
  options: ReduceRendererOptions = {},
): ReduceProgressRenderer {
  const stdout: CliWriter = options.stdout ?? process.stdout;
  const stderr: CliWriter = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now.bind(Date);
  const suppressLeadingBlankLine = options.suppressLeadingBlankLine === true;
  const suppressTrailingBlankLine = options.suppressTrailingBlankLine === true;

  let context: ReduceProgressContext | undefined;
  let disabled = false;
  let warningLogged = false;
  let blockInitialized = false;
  let lastRenderedLines = 0;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;

  const reducerOrder: string[] = [];
  const reducerRecords = new Map<string, ReduceProgressReducerRecord>();

  function stopRefreshLoop(): void {
    if (!refreshInterval) {
      return;
    }
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }

  function hasRunningReducers(): boolean {
    for (const reducer of reducerRecords.values()) {
      if (reducer.status === "running") {
        return true;
      }
    }
    return false;
  }

  function syncRefreshLoop(): void {
    if (!stdout.isTTY || disabled || !context || !hasRunningReducers()) {
      stopRefreshLoop();
      return;
    }
    if (refreshInterval) {
      return;
    }
    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context || !hasRunningReducers()) {
          stopRefreshLoop();
          return;
        }
        const nextElapsed = formatReduceProgressElapsed(context);
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
          `[voratiq] Progressive reduce output disabled: ${formatErrorDetail(error)}\n`,
        );
      }
    }
  }

  function formatReduceProgressElapsed(source: {
    status: ReduceProgressContext["status"];
    startedAt?: string;
    completedAt?: string;
  }): string | undefined {
    return formatRenderLifecycleDuration({
      lifecycle: {
        status: source.status,
        startedAt: source.startedAt,
        completedAt: source.completedAt,
      },
      terminalStatuses: TERMINAL_REDUCTION_STATUSES,
      now: now(),
    });
  }

  function safeParse(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  function formatDuration(record: ReduceProgressReducerRecord): string {
    if (record.status === "running") {
      return DASH;
    }
    return (
      formatRenderLifecycleDuration({
        lifecycle: {
          status: record.status,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
        },
        terminalStatuses: TERMINAL_REDUCTION_STATUSES,
        now: now(),
      }) ?? DASH
    );
  }

  function syncContextLifecycleFromReducerRecords(): void {
    if (!context) {
      return;
    }

    let earliestStartedAt = safeParse(context.startedAt);
    let latestCompletedAt = safeParse(context.completedAt);

    for (const reducer of reducerRecords.values()) {
      const startedAt = safeParse(reducer.startedAt);
      if (
        startedAt !== undefined &&
        (earliestStartedAt === undefined || startedAt < earliestStartedAt)
      ) {
        earliestStartedAt = startedAt;
      }

      const completedAt = safeParse(reducer.completedAt);
      if (
        completedAt !== undefined &&
        (latestCompletedAt === undefined || completedAt > latestCompletedAt)
      ) {
        latestCompletedAt = completedAt;
      }
    }

    context = {
      ...context,
      startedAt:
        earliestStartedAt === undefined
          ? undefined
          : new Date(earliestStartedAt).toISOString(),
      completedAt:
        latestCompletedAt === undefined
          ? undefined
          : new Date(latestCompletedAt).toISOString(),
    };
  }

  function buildReducerTable(style: TranscriptShellStyleOptions): string[] {
    if (reducerRecords.size === 0) {
      return [];
    }

    const resolvedStyle = resolveTranscriptShellStyle(style);
    const rows = reducerOrder
      .filter((reducerId) => reducerRecords.has(reducerId))
      .map((reducerId) => {
        const reducer = reducerRecords.get(reducerId)!;
        return {
          reducerAgentId: reducer.reducerAgentId,
          status: formatTranscriptStatusLabel(
            reducer.status,
            getAgentStatusStyle(reducer.status).cli,
            resolvedStyle,
          ),
          duration: formatDuration(reducer),
        };
      });

    return renderTranscriptStatusTable({
      rows,
      agent: (row) => row.reducerAgentId,
      status: (row) => row.status,
      duration: (row) => row.duration,
    });
  }

  function render(): void {
    if (!context || disabled || !stdout.isTTY) {
      return;
    }

    syncContextLifecycleFromReducerRecords();

    const style: TranscriptShellStyleOptions = { isTty: true };
    const elapsed = formatReduceProgressElapsed(context);
    lastElapsedLabel = elapsed ?? null;

    const shell = buildReduceStageShell({
      reductionId: context.reductionId,
      createdAt: context.createdAt,
      elapsed: elapsed ?? DASH,
      sourceLabel: context.sourceLabel,
      sourcePath: context.sourcePath,
      workspacePath: context.workspacePath,
      status: context.status,
      tableLines: buildReducerTable(style),
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

  function upsertReducer(record: ReduceProgressReducerRecord): void {
    if (!reducerOrder.includes(record.reducerAgentId)) {
      reducerOrder.push(record.reducerAgentId);
    }
    const existing = reducerRecords.get(record.reducerAgentId);
    reducerRecords.set(record.reducerAgentId, {
      ...existing,
      ...record,
      startedAt: record.startedAt ?? existing?.startedAt,
      completedAt: record.completedAt ?? existing?.completedAt,
    });
  }

  return {
    onProgressEvent(event): void {
      guard(() => {
        if (event.stage !== "reduce") {
          return;
        }

        if (event.type === "stage.begin") {
          context = { ...event.context };
          render();
          syncRefreshLoop();
          return;
        }

        if (event.type === "stage.candidate") {
          upsertReducer(event.candidate);
          render();
          syncRefreshLoop();
          return;
        }

        if (!context) {
          return;
        }

        context = {
          ...context,
          status: event.status as ReduceProgressContext["status"],
        };
        render();
        syncRefreshLoop();
      });
    },
    begin(nextContext?: ReduceProgressContext): void {
      guard(() => {
        if (!nextContext) {
          render();
          syncRefreshLoop();
          return;
        }
        this.onProgressEvent({
          type: "stage.begin",
          stage: "reduce",
          context: nextContext,
        });
      });
    },
    update(record: ReduceProgressReducerRecord): void {
      this.onProgressEvent({
        type: "stage.candidate",
        stage: "reduce",
        candidate: record,
      });
    },
    complete(
      status?: ReduceProgressContext["status"],
      lifecycle?: { startedAt?: string; completedAt?: string },
    ): void {
      stopRefreshLoop();
      guard(() => {
        if (context && lifecycle) {
          context = {
            ...context,
            startedAt: lifecycle.startedAt ?? context.startedAt,
            completedAt: lifecycle.completedAt ?? context.completedAt,
          };
        }

        if (status) {
          this.onProgressEvent({
            type: "stage.status",
            stage: "reduce",
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

export function renderReduceTranscript(
  options: ReduceTranscriptOptions,
): string {
  const {
    reductionId,
    createdAt,
    elapsed,
    sourceLabel,
    sourcePath,
    workspacePath,
    status,
    reducers,
    nextCommandLines,
    suppressHint,
    isTty,
    includeSummarySection = true,
  } = options;

  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);
  const sections: string[][] = [];

  if (includeSummarySection) {
    const summaryShell = buildReduceStageShell({
      reductionId,
      createdAt,
      elapsed,
      sourceLabel,
      sourcePath,
      workspacePath,
      status,
      tableLines:
        reducers.length > 0
          ? renderTranscriptStatusTable({
              rows: reducers,
              agent: (row) => row.reducerAgentId,
              status: (row) =>
                formatTranscriptStatusLabel(
                  row.status,
                  getAgentStatusStyle(
                    row.status === "running" ? "running" : row.status,
                  ).cli,
                  resolvedStyle,
                ),
              duration: (row) => row.duration,
            })
          : [],
      style,
    });
    sections.push(...buildStageFrameSections(summaryShell));
  }

  if (reducers.length > 0) {
    sections.push(["---"]);
  }

  reducers.forEach((reducer, index) => {
    const block: string[] = [`Reducer: ${reducer.reducerAgentId}`];
    if (reducer.previewLines && reducer.previewLines.length > 0) {
      block.push("", ...reducer.previewLines);
    }
    if (reducer.errorLine) {
      const inlineError = reducer.errorLine.replace(/\s+/gu, " ").trim();
      block.push("", formatAgentErrorLine(inlineError, style));
    }
    if (reducer.outputPath && reducer.status === "succeeded") {
      block.push("", `Reduction: ${reducer.outputPath}`);
    }
    if (index < reducers.length - 1) {
      block.push("", "---");
    }
    sections.push(block);
  });

  const hint =
    suppressHint || !nextCommandLines || nextCommandLines.length === 0
      ? undefined
      : {
          message: `---\n\nNext:\n${nextCommandLines
            .map((line) => `  ${line}`)
            .join("\n")}`,
        };

  return renderTranscript({ sections, hint });
}

export function formatReducerDuration(options: {
  status: ReduceProgressReducerRecord["status"];
  startedAt?: string;
  completedAt?: string;
  now?: number;
}): string {
  return (
    formatRenderLifecycleDuration({
      lifecycle: {
        status: options.status,
        startedAt: options.startedAt,
        completedAt: options.completedAt,
      },
      terminalStatuses: TERMINAL_REDUCTION_STATUSES,
      now: options.now,
    }) ?? "—"
  );
}

export function formatReduceElapsed(options: {
  status: ReduceProgressContext["status"];
  startedAt?: string;
  completedAt?: string;
  now?: number;
}): string | undefined {
  return formatRenderLifecycleDuration({
    lifecycle: {
      status: options.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
    },
    terminalStatuses: TERMINAL_REDUCTION_STATUSES,
    now: options.now,
  });
}
