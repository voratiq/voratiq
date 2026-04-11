import type {
  AgentInvocationRecord,
  RunReport,
} from "../../domain/run/model/types.js";
import { TERMINAL_RUN_STATUSES } from "../../status/index.js";
import { formatCompactDiffStatistics } from "../../utils/diff.js";
import {
  formatAgentDuration,
  formatAgentErrorLine,
  formatAgentStatusLabelWithStyle,
} from "../utils/agents.js";
import { formatAgentBadge } from "../utils/badges.js";
import { formatRenderLifecycleDuration } from "../utils/duration.js";
import { createInteractiveFrameRenderer } from "../utils/interactive-frame.js";
import { formatRunTimestamp } from "../utils/records.js";
import { buildRunMetadataSectionWithStyle } from "../utils/runs.js";
import {
  buildStageFrameLines,
  renderStageFinalFrame,
} from "../utils/stage-output.js";
import { renderTranscript } from "../utils/transcript.js";
import type { TranscriptShellStyleOptions } from "../utils/transcript-shell.js";
import {
  renderTranscriptStatusTable,
  resolveTranscriptShellStyle,
  resolveTranscriptShellStyleFromWriter,
} from "../utils/transcript-shell.js";
import type { StageProgressEventConsumer } from "./stage-progress.js";

type CliWriter = Pick<NodeJS.WriteStream, "write"> & {
  isTTY?: boolean;
  columns?: number;
};

interface RunProgressContext {
  runId: string;
  status: RunReport["status"];
  workspacePath: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface RunRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

interface RunProgressRenderer extends StageProgressEventConsumer<
  RunProgressContext,
  AgentInvocationRecord
> {
  begin(context?: RunProgressContext): void;
  update(record: AgentInvocationRecord): void;
  complete(report: RunReport, options?: { suppressHint?: boolean }): string;
}

interface AgentRow {
  agentId: string;
  status: string;
  duration: string;
  diff: string;
}

export interface RunTranscriptAgentRecord {
  agentId: string;
  status: AgentInvocationRecord["status"];
  startedAt?: string;
  completedAt?: string;
  diffStatistics?: string;
  outputPath?: string;
  errorLine?: string;
}

export interface RunTranscriptOptions {
  runId: string;
  status: RunReport["status"];
  workspacePath: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  targetDisplay?: string;
  agents: readonly RunTranscriptAgentRecord[];
  isTty?: boolean;
  now?: number;
}

const DASH = "—";

export function formatRunElapsed(
  source: {
    status: RunReport["status"];
    startedAt?: string;
    completedAt?: string;
  },
  now?: number,
): string | undefined {
  return formatRenderLifecycleDuration({
    lifecycle: {
      status: source.status,
      startedAt: source.startedAt,
      completedAt: source.completedAt,
    },
    terminalStatuses: TERMINAL_RUN_STATUSES,
    now,
  });
}

export function renderRunTranscript(options: RunTranscriptOptions): string {
  const style = resolveTranscriptShellStyle({ isTty: options.isTty });
  const shell = {
    metadataLines: buildRunMetadataSectionWithStyle(
      {
        runId: options.runId,
        status: options.status,
        workspacePath: options.workspacePath,
        elapsed:
          formatRunElapsed(
            {
              status: options.status,
              startedAt: options.startedAt,
              completedAt: options.completedAt,
            },
            options.now,
          ) ?? DASH,
        createdAt: formatRunTimestamp(options.createdAt),
        targetDisplay: options.targetDisplay,
      },
      style,
    ),
    statusTableLines:
      options.agents.length === 0
        ? []
        : renderTranscriptStatusTable({
            rows: options.agents.map((agent) => ({
              agentId: formatAgentBadge(agent.agentId, style),
              status: formatAgentStatusLabelWithStyle(agent.status, style),
              duration:
                agent.status === "running"
                  ? DASH
                  : (formatAgentDuration(agent, {
                      now: options.now ?? Date.now(),
                    }) ?? DASH),
              diff: formatCompactDiffStatistics(agent.diffStatistics) ?? DASH,
            })),
            agent: (row) => row.agentId,
            status: (row) => row.status,
            duration: (row) => row.duration,
            extras: [{ header: "CHANGES", accessor: (row) => row.diff }],
          }),
  };

  if (options.agents.length === 0) {
    return renderStageFinalFrame({
      metadataLines: shell.metadataLines,
      statusTableLines: shell.statusTableLines,
    });
  }

  const sections: string[][] = [
    [
      ...shell.metadataLines,
      ...(shell.statusTableLines.length > 0
        ? ["", ...shell.statusTableLines]
        : []),
    ],
    ["---"],
  ];

  options.agents.forEach((agent, index) => {
    const block: string[] = [`Agent: ${agent.agentId}`];

    if (agent.errorLine) {
      const inlineError = agent.errorLine.replace(/\s+/gu, " ").trim();
      block.push("", formatAgentErrorLine(inlineError, style));
    }

    block.push("", `Output: ${agent.outputPath ?? DASH}`);

    if (index < options.agents.length - 1) {
      block.push("", "---");
    }

    sections.push(block);
  });

  return renderTranscript({ sections });
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
      // ignore JSON serialization failures; fall through to default message.
    }
  }

  return "unknown error";
}

export function createRunRenderer(
  options: RunRendererOptions = {},
): RunProgressRenderer {
  const stdout: CliWriter = options.stdout ?? process.stdout;
  const stderr: CliWriter = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now.bind(Date);
  const suppressLeadingBlankLine = options.suppressLeadingBlankLine === true;
  const suppressTrailingBlankLine = options.suppressTrailingBlankLine === true;

  let context: RunProgressContext | undefined;
  let disabled = false;
  let warningLogged = false;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;
  const interactiveFrameRenderer = createInteractiveFrameRenderer(stdout);

  const agentOrder: string[] = [];
  const agentRecords = new Map<string, AgentInvocationRecord>();

  function stopRefreshLoop(): void {
    if (!refreshInterval) {
      return;
    }

    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }

  function hasRunningAgents(): boolean {
    for (const record of agentRecords.values()) {
      if (record.status === "running") {
        return true;
      }
    }

    return false;
  }

  function syncRefreshLoop(): void {
    if (!stdout.isTTY || disabled) {
      stopRefreshLoop();
      return;
    }

    if (!hasRunningAgents()) {
      stopRefreshLoop();
      return;
    }

    if (refreshInterval) {
      return;
    }

    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context) {
          stopRefreshLoop();
          return;
        }

        if (!hasRunningAgents()) {
          stopRefreshLoop();
          return;
        }

        const nextElapsed = formatRunElapsed(context);
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
        const detail = formatErrorDetail(error);
        stderr.write(`[voratiq] Progressive run output disabled: ${detail}\n`);
      }
    }
  }

  function resolveFinalContext(report: RunReport): RunProgressContext {
    return {
      runId: context?.runId ?? report.runId,
      status: report.status,
      workspacePath: context?.workspacePath ?? "",
      createdAt: context?.createdAt ?? report.createdAt,
      startedAt: context?.startedAt ?? report.startedAt,
      completedAt: context?.completedAt ?? report.completedAt,
    };
  }

  function buildRunStageShell(
    source: RunProgressContext,
    style: TranscriptShellStyleOptions,
  ): {
    metadataLines: string[];
    statusTableLines: string[];
  } {
    const elapsedLabel = formatRunElapsed(source);
    lastElapsedLabel = elapsedLabel ?? null;

    return {
      metadataLines: buildRunMetadataSectionWithStyle(
        {
          runId: source.runId,
          status: source.status,
          workspacePath: source.workspacePath,
          elapsed: elapsedLabel,
          createdAt: formatRunTimestamp(source.createdAt),
        },
        style,
      ),
      statusTableLines: buildAgentTable(style),
    };
  }

  function render(): void {
    if (!context || disabled || !stdout.isTTY) {
      return;
    }

    const style: TranscriptShellStyleOptions =
      resolveTranscriptShellStyleFromWriter(stdout, { forceTty: true });
    const shell = buildRunStageShell(context, style);
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

  function buildAgentTable(style: TranscriptShellStyleOptions): string[] {
    if (agentRecords.size === 0) {
      return [];
    }

    const rows: AgentRow[] = agentOrder
      .filter((agentId) => agentRecords.has(agentId))
      .map((agentId) => {
        const record = agentRecords.get(agentId)!;
        return {
          agentId: formatAgentBadge(agentId, style),
          status: formatAgentStatusLabelWithStyle(record.status, style),
          duration: formatDuration(record),
          diff: formatDiffCell(record.diffStatistics),
        };
      });

    return renderTranscriptStatusTable({
      rows,
      agent: (row) => row.agentId,
      status: (row) => row.status,
      duration: (row) => row.duration,
      extras: [{ header: "CHANGES", accessor: (row) => row.diff }],
    });
  }

  function formatDiffCell(value?: string): string {
    const compact = formatCompactDiffStatistics(value);
    if (compact) {
      return compact;
    }
    return value ?? DASH;
  }

  function formatDuration(record: AgentInvocationRecord): string {
    if (record.status === "running") {
      return DASH;
    }
    const duration = formatAgentDuration(record, { now: now() });
    return duration ?? DASH;
  }

  function formatRunElapsed(source: {
    status: RunReport["status"];
    startedAt?: string;
    completedAt?: string;
  }): string | undefined {
    return formatRenderLifecycleDuration({
      lifecycle: {
        status: source.status,
        startedAt: source.startedAt,
        completedAt: source.completedAt,
      },
      terminalStatuses: TERMINAL_RUN_STATUSES,
      now: now(),
    });
  }

  function upsertRecord(record: AgentInvocationRecord): void {
    if (!agentOrder.includes(record.agentId)) {
      agentOrder.push(record.agentId);
    }

    agentRecords.set(record.agentId, record);
  }

  function syncRecordsFromReport(report: RunReport): void {
    const sortedAgents = [...report.agents].sort((a, b) =>
      a.agentId.localeCompare(b.agentId),
    );

    for (const agent of sortedAgents) {
      const existing = agentRecords.get(agent.agentId);
      upsertRecord({
        agentId: agent.agentId,
        model: existing?.model ?? "unknown",
        status: agent.status,
        startedAt: agent.startedAt,
        completedAt: agent.completedAt,
        diffStatistics: agent.diffStatistics,
        error: agent.error,
        warnings: agent.warnings,
      });
    }
  }

  function ensureFinalRender(report: RunReport): void {
    if (!context) {
      return;
    }

    context = {
      ...context,
      status: report.status,
      startedAt: report.startedAt ?? context.startedAt,
      completedAt: report.completedAt ?? context.completedAt,
    };

    render();
  }

  return {
    onProgressEvent(event): void {
      guard(() => {
        if (event.stage !== "run") {
          return;
        }

        if (event.type === "stage.begin") {
          context = { ...event.context };
          render();
          syncRefreshLoop();
          return;
        }

        if (event.type === "stage.candidate") {
          upsertRecord(event.candidate);
          render();
          syncRefreshLoop();
          return;
        }

        if (!context) {
          return;
        }

        context = {
          ...context,
          status: event.status as RunReport["status"],
        };
        render();
        syncRefreshLoop();
      });
    },
    begin(beginContext?: RunProgressContext): void {
      guard(() => {
        if (!beginContext) {
          render();
          syncRefreshLoop();
          return;
        }
        this.onProgressEvent({
          type: "stage.begin",
          stage: "run",
          context: beginContext,
        });
      });
    },
    update(record: AgentInvocationRecord): void {
      this.onProgressEvent({
        type: "stage.candidate",
        stage: "run",
        candidate: record,
      });
    },
    complete(report: RunReport, options?: { suppressHint?: boolean }): string {
      stopRefreshLoop();
      syncRecordsFromReport(report);
      guard(() => {
        this.onProgressEvent({
          type: "stage.status",
          stage: "run",
          status: report.status,
        });
        ensureFinalRender(report);

        disabled = true;
      });

      const hint = options?.suppressHint
        ? undefined
        : {
            message: `To verify results:\n  voratiq verify --run ${report.runId}`,
          };

      if (stdout.isTTY) {
        return hint?.message ?? "";
      }

      const finalContext = resolveFinalContext(report);
      const finalShell = buildRunStageShell(finalContext, { isTty: false });
      return renderStageFinalFrame({
        metadataLines: finalShell.metadataLines,
        statusTableLines: finalShell.statusTableLines,
        hint,
      });
    },
  };
}

export type { RunProgressContext, RunProgressRenderer };
