import type { ExtractedTokenUsage } from "../../domain/run/model/types.js";
import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { TERMINAL_SPEC_STATUSES } from "../../status/index.js";
import type { TokenUsageResult } from "../../workspace/chat/token-usage-result.js";
import { formatAgentErrorLine } from "../utils/agents.js";
import { formatAgentBadge } from "../utils/badges.js";
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
  renderStageFinalFrame,
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

const DASH = "—";

export interface SpecProgressContext {
  sessionId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed" | "aborted";
}

export interface SpecProgressAgentRecord {
  agentId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt?: string;
  completedAt?: string;
  tokenUsage?: ExtractedTokenUsage;
  tokenUsageResult?: TokenUsageResult;
}

interface SpecRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

export interface SpecProgressRenderer extends StageProgressEventConsumer<
  SpecProgressContext,
  SpecProgressAgentRecord
> {
  begin(context?: SpecProgressContext): void;
  update(record: SpecProgressAgentRecord): void;
  complete(
    status?: SpecProgressContext["status"],
    lifecycle?: { startedAt?: string; completedAt?: string },
  ): void;
}

export interface SpecTranscriptAgentBlock {
  agentId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  duration: string;
  outputPath?: string;
  dataPath?: string;
  previewLines?: readonly string[];
  errorLine?: string;
}

export interface SpecTranscriptOptions {
  sessionId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  agents: readonly SpecTranscriptAgentBlock[];
  nextCommandLines?: readonly string[];
  isTty?: boolean;
  includeSummarySection?: boolean;
  includeDetailSections?: boolean;
}

function buildSpecStageShell(options: {
  sessionId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  tableLines?: string[];
  style?: TranscriptShellStyleOptions;
}): {
  metadataLines: string[];
  statusTableLines: string[];
} {
  return {
    metadataLines: buildStandardSessionShellSection({
      badgeText: options.sessionId,
      badgeVariant: "spec",
      status: {
        value: options.status,
        color: getRunStatusStyle(options.status).cli,
      },
      elapsed: options.elapsed,
      createdAt: options.createdAt,
      workspacePath: options.workspacePath,
      style: options.style,
    }),
    statusTableLines: options.tableLines ?? [],
  };
}

export function createSpecRenderer(
  options: SpecRendererOptions = {},
): SpecProgressRenderer {
  const stdout: CliWriter = options.stdout ?? process.stdout;
  const stderr: CliWriter = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now.bind(Date);
  const suppressLeadingBlankLine = options.suppressLeadingBlankLine === true;
  const suppressTrailingBlankLine = options.suppressTrailingBlankLine === true;

  let context: SpecProgressContext | undefined;
  let disabled = false;
  let warningLogged = false;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;
  const interactiveFrameRenderer = createInteractiveFrameRenderer(stdout);

  const agentOrder: string[] = [];
  const agentRecords = new Map<string, SpecProgressAgentRecord>();

  function hasRunningAgents(): boolean {
    for (const agent of agentRecords.values()) {
      if (agent.status === "running") {
        return true;
      }
    }
    return false;
  }

  function syncRefreshLoop(): void {
    if (!stdout.isTTY || disabled || !context || !hasRunningAgents()) {
      refreshInterval = clearRefreshIntervalHandle(refreshInterval);
      return;
    }
    if (refreshInterval) {
      return;
    }
    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context || !hasRunningAgents()) {
          refreshInterval = clearRefreshIntervalHandle(refreshInterval);
          return;
        }
        const nextElapsed = formatSpecElapsed(context, now());
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
          `[voratiq] Progressive spec output disabled: ${formatProgressiveRenderErrorDetail(
            error,
          )}\n`,
        );
      }
    }
  }

  function formatDuration(record: SpecProgressAgentRecord): string {
    return formatRenderLifecycleRowDuration({
      lifecycle: {
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
      terminalStatuses: ["succeeded", "failed"],
      now: now(),
    });
  }

  function syncContextLifecycleFromAgentRecords(): void {
    if (!context) {
      return;
    }

    let earliestStartedAt = parseProgressTimestamp(context.startedAt);
    let latestCompletedAt = parseProgressTimestamp(context.completedAt);

    for (const agent of agentRecords.values()) {
      const startedAt = parseProgressTimestamp(agent.startedAt);
      if (
        startedAt !== undefined &&
        (earliestStartedAt === undefined || startedAt < earliestStartedAt)
      ) {
        earliestStartedAt = startedAt;
      }

      const completedAt = parseProgressTimestamp(agent.completedAt);
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

  function buildAgentTable(style: TranscriptShellStyleOptions): string[] {
    if (agentRecords.size === 0) {
      return [];
    }

    const resolvedStyle = resolveTranscriptShellStyle(style);
    const rows = agentOrder
      .map((agentId) => {
        const agent = agentRecords.get(agentId);
        if (!agent) {
          return undefined;
        }
        return {
          agentId: formatAgentBadge(agent.agentId, style),
          status: formatTranscriptStatusLabel(
            agent.status,
            getAgentStatusStyle(agent.status).cli,
            resolvedStyle,
          ),
          duration: formatDuration(agent),
        };
      })
      .filter(
        (row): row is { agentId: string; status: string; duration: string } =>
          row !== undefined,
      );

    return renderTranscriptStatusTable({
      rows,
      agent: (row) => row.agentId,
      status: (row) => row.status,
      duration: (row) => row.duration,
    });
  }

  function render(): void {
    if (!context || disabled || !stdout.isTTY) {
      return;
    }

    syncContextLifecycleFromAgentRecords();

    const style: TranscriptShellStyleOptions =
      resolveTranscriptShellStyleFromWriter(stdout, { forceTty: true });
    const elapsed = formatSpecElapsed(context, now());
    lastElapsedLabel = elapsed ?? null;

    const shell = buildSpecStageShell({
      sessionId: context.sessionId,
      createdAt: context.createdAt,
      elapsed: elapsed ?? DASH,
      workspacePath: context.workspacePath,
      status: context.status,
      tableLines: buildAgentTable(style),
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

  function upsertAgent(record: SpecProgressAgentRecord): void {
    if (!agentOrder.includes(record.agentId)) {
      agentOrder.push(record.agentId);
    }
    const existing = agentRecords.get(record.agentId);
    agentRecords.set(record.agentId, {
      ...existing,
      ...record,
      startedAt: record.startedAt ?? existing?.startedAt,
      completedAt: record.completedAt ?? existing?.completedAt,
    });
  }

  return {
    onProgressEvent(event): void {
      guard(() => {
        if (event.stage !== "spec") {
          return;
        }
        if (event.type === "stage.begin") {
          context = { ...event.context };
          render();
          syncRefreshLoop();
          return;
        }
        if (event.type === "stage.candidate") {
          upsertAgent(event.candidate);
          render();
          syncRefreshLoop();
          return;
        }
        if (!context) {
          return;
        }
        context = {
          ...context,
          status: event.status as SpecProgressContext["status"],
        };
        render();
        syncRefreshLoop();
      });
    },
    begin(nextContext?: SpecProgressContext): void {
      guard(() => {
        if (!nextContext) {
          render();
          syncRefreshLoop();
          return;
        }
        this.onProgressEvent({
          type: "stage.begin",
          stage: "spec",
          context: nextContext,
        });
      });
    },
    update(record: SpecProgressAgentRecord): void {
      this.onProgressEvent({
        type: "stage.candidate",
        stage: "spec",
        candidate: record,
      });
    },
    complete(
      status?: SpecProgressContext["status"],
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
            stage: "spec",
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

export function formatSpecElapsed(
  options: {
    status: SpecProgressContext["status"];
    startedAt?: string;
    completedAt?: string;
  },
  now?: number,
): string | undefined {
  return formatRenderLifecycleDuration({
    lifecycle: {
      status: options.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
    },
    terminalStatuses: TERMINAL_SPEC_STATUSES,
    now,
  });
}

export function formatSpecAgentDuration(options: {
  status: SpecTranscriptAgentBlock["status"];
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
    terminalStatuses: ["succeeded", "failed"],
    now: options.now,
  });
}

export function renderSpecTranscript(
  input: SpecTranscriptOptions | string,
  options: { suppressHint?: boolean } = {},
): string {
  const { suppressHint } = options;

  if (typeof input === "string") {
    return renderStageFinalFrame({
      metadataLines: [`Spec saved: ${input}`],
    });
  }

  const {
    sessionId,
    createdAt,
    elapsed,
    workspacePath,
    status,
    agents,
    nextCommandLines,
    isTty,
    includeSummarySection = true,
    includeDetailSections = true,
  } = input;

  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);
  const sections: string[][] = [];

  if (includeSummarySection) {
    const summaryShell = buildSpecStageShell({
      sessionId,
      createdAt,
      elapsed,
      workspacePath,
      status,
      tableLines:
        agents.length > 0
          ? renderTranscriptStatusTable({
              rows: agents,
              agent: (row) => row.agentId,
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

  if (includeDetailSections && agents.length > 0) {
    sections.push(["---"]);
  }

  if (!includeDetailSections) {
    return renderTranscript({ sections });
  }

  agents.forEach((agent, index) => {
    const block: string[] = [`Agent: ${agent.agentId}`];
    if (agent.previewLines && agent.previewLines.length > 0) {
      block.push("", ...agent.previewLines);
    }
    if (agent.errorLine) {
      const inlineError = agent.errorLine.replace(/\s+/gu, " ").trim();
      block.push("", formatAgentErrorLine(inlineError, style));
    }
    block.push("", `Output: ${agent.outputPath ?? DASH}`);
    if (index < agents.length - 1) {
      block.push("", "---");
    }
    sections.push(block);
  });

  const hint =
    suppressHint || !nextCommandLines || nextCommandLines.length === 0
      ? undefined
      : {
          message: `---\n\nTo run a spec:\n${nextCommandLines
            .map((line) => `  ${line}`)
            .join("\n")}`,
        };

  return renderTranscript({ sections, hint });
}
