import type { ExtractedTokenUsage } from "../../domain/run/model/types.js";
import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { TERMINAL_REDUCTION_STATUSES } from "../../status/index.js";
import type { TokenUsageResult } from "../../workspace/chat/token-usage-result.js";
import { formatAgentErrorLine } from "../utils/agents.js";
import type { CliWriter } from "../utils/cli-writer.js";
import {
  formatRenderLifecycleDuration,
  formatRenderLifecycleRowDuration,
} from "../utils/duration.js";
import { createInteractiveFrameRenderer } from "../utils/interactive-frame.js";
import {
  clearRefreshIntervalHandle,
  formatProgressiveRenderErrorDetail,
  parseProgressTimestamp,
} from "../utils/progressive-render.js";
import {
  buildStageFrameLines,
  buildStageFrameSections,
} from "../utils/stage-output.js";
import { renderTranscript } from "../utils/transcript.js";
import type { TranscriptShellStyleOptions } from "../utils/transcript-shell.js";
import {
  buildStandardSessionShellSection,
  formatTranscriptStatusLabel,
  renderTranscriptStatusTable,
  resolveTranscriptShellStyle,
  resolveTranscriptShellStyleFromWriter,
} from "../utils/transcript-shell.js";
import type { StageProgressEventConsumer } from "./stage-progress.js";

export interface ReduceProgressContext {
  reductionId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
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

export interface ReduceProgressRenderer extends StageProgressEventConsumer<
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

const DASH = "—";

export interface ReduceTranscriptReducerBlock {
  reducerAgentId: string;
  status: "queued" | "succeeded" | "failed" | "aborted" | "running";
  duration: string;
  outputPath?: string;
  dataPath?: string;
  previewLines?: string[];
  errorLine?: string;
}

export interface ReduceTranscriptOptions {
  reductionId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "queued" | "succeeded" | "failed" | "aborted" | "running";
  targetDisplay?: string;
  reducers: readonly ReduceTranscriptReducerBlock[];
  nextCommandLines?: readonly string[];
  suppressHint?: boolean;
  isTty?: boolean;
  includeSummarySection?: boolean;
  includeDetailSections?: boolean;
}

function buildReduceStageShell(options: {
  reductionId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "queued" | "succeeded" | "failed" | "aborted" | "running";
  targetDisplay?: string;
  tableLines?: string[];
  style?: TranscriptShellStyleOptions;
}): {
  metadataLines: string[];
  statusTableLines: string[];
} {
  const metadataLines = buildStandardSessionShellSection({
    badgeText: options.reductionId,
    badgeVariant: "reduce",
    status: {
      value: options.status,
      color: getRunStatusStyle(options.status).cli,
    },
    elapsed: options.elapsed,
    createdAt: options.createdAt,
    workspacePath: options.workspacePath,
    targetDisplay: options.targetDisplay,
    style: options.style,
  });

  return {
    metadataLines,
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
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;
  const interactiveFrameRenderer = createInteractiveFrameRenderer(stdout);

  const reducerOrder: string[] = [];
  const reducerRecords = new Map<string, ReduceProgressReducerRecord>();

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
      refreshInterval = clearRefreshIntervalHandle(refreshInterval);
      return;
    }
    if (refreshInterval) {
      return;
    }
    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context || !hasRunningReducers()) {
          refreshInterval = clearRefreshIntervalHandle(refreshInterval);
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
      refreshInterval = clearRefreshIntervalHandle(refreshInterval);
      if (!warningLogged) {
        warningLogged = true;
        stderr.write(
          `[voratiq] Progressive reduce output disabled: ${formatProgressiveRenderErrorDetail(
            error,
          )}\n`,
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

  function formatDuration(record: ReduceProgressReducerRecord): string {
    return formatRenderLifecycleRowDuration({
      lifecycle: {
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
      terminalStatuses: TERMINAL_REDUCTION_STATUSES,
      now: now(),
    });
  }

  function syncContextLifecycleFromReducerRecords(): void {
    if (!context) {
      return;
    }

    let earliestStartedAt = parseProgressTimestamp(context.startedAt);
    let latestCompletedAt = parseProgressTimestamp(context.completedAt);

    for (const reducer of reducerRecords.values()) {
      const startedAt = parseProgressTimestamp(reducer.startedAt);
      if (
        startedAt !== undefined &&
        (earliestStartedAt === undefined || startedAt < earliestStartedAt)
      ) {
        earliestStartedAt = startedAt;
      }

      const completedAt = parseProgressTimestamp(reducer.completedAt);
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

    const style: TranscriptShellStyleOptions =
      resolveTranscriptShellStyleFromWriter(stdout, { forceTty: true });
    const elapsed = formatReduceProgressElapsed(context);
    lastElapsedLabel = elapsed ?? null;

    const shell = buildReduceStageShell({
      reductionId: context.reductionId,
      createdAt: context.createdAt,
      elapsed: elapsed ?? DASH,
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

    interactiveFrameRenderer.render(interactiveLines);
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
      refreshInterval = clearRefreshIntervalHandle(refreshInterval);
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
    workspacePath,
    status,
    targetDisplay,
    reducers,
    nextCommandLines,
    suppressHint,
    isTty,
    includeSummarySection = true,
    includeDetailSections = true,
  } = options;

  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);
  const sections: string[][] = [];

  if (includeSummarySection) {
    const summaryShell = buildReduceStageShell({
      reductionId,
      createdAt,
      elapsed,
      workspacePath,
      status,
      targetDisplay,
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

  if (includeDetailSections && reducers.length > 0) {
    sections.push(["---"]);
  }

  if (!includeDetailSections) {
    return renderTranscript({ sections });
  }

  reducers.forEach((reducer, index) => {
    const block: string[] = [`Agent: ${reducer.reducerAgentId}`];
    if (reducer.previewLines && reducer.previewLines.length > 0) {
      block.push("", ...reducer.previewLines);
    }
    if (reducer.errorLine) {
      const inlineError = reducer.errorLine.replace(/\s+/gu, " ").trim();
      block.push("", formatAgentErrorLine(inlineError, style));
    }
    block.push("", `Output: ${reducer.outputPath ?? DASH}`);
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
  return formatRenderLifecycleRowDuration({
    lifecycle: {
      status: options.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
    },
    terminalStatuses: TERMINAL_REDUCTION_STATUSES,
    now: options.now,
  });
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
