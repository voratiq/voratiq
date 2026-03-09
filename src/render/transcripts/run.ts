import type {
  AgentInvocationRecord,
  RunReport,
} from "../../domains/runs/model/types.js";
import { getEvalStatusStyle } from "../../status/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatCompactDiffStatistics } from "../../utils/diff.js";
import {
  formatAgentDuration,
  formatAgentStatusLabelWithStyle,
  formatDurationLabel,
} from "../utils/agents.js";
import { formatAgentBadge } from "../utils/badges.js";
import { formatRunTimestamp } from "../utils/records.js";
import { buildRunMetadataSectionWithStyle } from "../utils/runs.js";
import {
  buildStageFrameLines,
  renderStageFinalFrame,
} from "../utils/stage-output.js";
import type { TranscriptShellStyleOptions } from "../utils/transcript-shell.js";
import { renderTranscriptStatusTable } from "../utils/transcript-shell.js";
import type { StageProgressEventConsumer } from "./stage-progress.js";

type CliWriter = Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };

interface RunProgressContext {
  runId: string;
  status: RunReport["status"];
  specPath: string;
  workspacePath: string;
  createdAt: string;
  baseRevisionSha: string;
}

interface RunRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

interface RunProgressRenderer
  extends StageProgressEventConsumer<
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
  evals: string;
}

const ERASE_LINE = "\u001b[2K";
const CURSOR_COLUMN_START = "\u001b[0G";

function cursorUp(lines: number): string {
  return `\u001b[${lines}F`;
}

const DASH = "—";

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
  let lastRenderedLines = 0;
  let blockInitialized = false;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;

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

        const nextElapsed =
          context.createdAt && formatRunElapsed(context.createdAt);
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
      specPath: context?.specPath ?? report.spec.path,
      workspacePath: context?.workspacePath ?? "",
      createdAt: context?.createdAt ?? report.createdAt,
      baseRevisionSha: context?.baseRevisionSha ?? report.baseRevisionSha,
    };
  }

  function buildRunStageShell(
    source: RunProgressContext,
    style: TranscriptShellStyleOptions,
  ): {
    metadataLines: string[];
    statusTableLines: string[];
  } {
    const elapsedLabel = source.createdAt
      ? (formatRunElapsed(source.createdAt) ?? undefined)
      : undefined;
    lastElapsedLabel = elapsedLabel ?? null;

    return {
      metadataLines: buildRunMetadataSectionWithStyle(
        {
          runId: source.runId,
          status: source.status,
          specPath: source.specPath,
          workspacePath: source.workspacePath,
          elapsed: elapsedLabel,
          createdAt: formatRunTimestamp(source.createdAt),
          baseRevisionSha: source.baseRevisionSha,
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

    const style: TranscriptShellStyleOptions = { isTty: true };
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
          evals: formatEvals(record, style),
        };
      });

    return renderTranscriptStatusTable({
      rows,
      agent: (row) => row.agentId,
      status: (row) => row.status,
      duration: (row) => row.duration,
      extras: [
        { header: "CHANGES", accessor: (row) => row.diff },
        { header: "EVALS", accessor: (row) => row.evals },
      ],
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
    const duration = formatAgentDuration(record);
    return duration ?? DASH;
  }

  function formatRunElapsed(createdAt: string): string | undefined {
    if (!createdAt) {
      return undefined;
    }

    const startedAt = Date.parse(createdAt);
    if (Number.isNaN(startedAt)) {
      return undefined;
    }

    const elapsedMs = Math.max(0, now() - startedAt);
    return formatDurationLabel(elapsedMs);
  }

  function formatEvals(
    record: AgentInvocationRecord,
    style: TranscriptShellStyleOptions,
  ): string {
    if (!record.evals || record.evals.length === 0) {
      return DASH;
    }

    if (!style.isTty) {
      return record.evals.map((evaluation) => evaluation.slug).join(" ");
    }

    return record.evals
      .map((evaluation) =>
        colorize(evaluation.slug, getEvalStatusStyle(evaluation.status).cli),
      )
      .join(" ");
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
        evals: agent.evals,
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
            message: `To review results:\n  voratiq review --run ${report.runId}`,
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
