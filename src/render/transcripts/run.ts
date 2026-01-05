import type {
  AgentInvocationRecord,
  RunReport,
} from "../../runs/records/types.js";
import { getEvalStatusStyle } from "../../status/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatCompactDiffStatistics } from "../../utils/diff.js";
import {
  formatAgentDuration,
  formatAgentStatusLabel,
  formatDurationLabel,
} from "../utils/agents.js";
import { formatAgentBadge } from "../utils/badges.js";
import { formatRunTimestamp } from "../utils/records.js";
import { buildRunMetadataSection } from "../utils/runs.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";

const SUPPRESS_RUN_STATUS_TABLE_ENV = "VORATIQ_SUPPRESS_RUN_STATUS_TABLE";

function shouldSuppressRunStatusTable(): boolean {
  const flag = process.env[SUPPRESS_RUN_STATUS_TABLE_ENV];
  return flag === "1" || flag?.toLowerCase() === "true";
}

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
}

interface RunProgressRenderer {
  begin(context?: RunProgressContext): void;
  update(record: AgentInvocationRecord): void;
  complete(report: RunReport): string;
}

interface AgentRow {
  agentId: string;
  status: string;
  elapsed: string;
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

  let context: RunProgressContext | undefined;
  let disabled = shouldSuppressRunStatusTable();
  let warningLogged = false;
  let lastRenderedLines = 0;
  let blockInitialized = false;
  let metadataPrinted = false;

  const agentOrder: string[] = [];
  const agentRecords = new Map<string, AgentInvocationRecord>();

  function guard(action: () => void): void {
    if (disabled) {
      return;
    }
    try {
      action();
    } catch (error) {
      disabled = true;
      if (!warningLogged) {
        warningLogged = true;
        const detail = formatErrorDetail(error);
        stderr.write(`[voratiq] Progressive run output disabled: ${detail}\n`);
      }
    }
  }

  function buildInteractiveLines(
    metadataLines: string[],
    tableLines: string[],
  ): string[] {
    if (metadataLines.length === 0) {
      return [];
    }

    const lines: string[] = [""];
    lines.push(...metadataLines);

    if (tableLines.length > 0) {
      lines.push("");
      lines.push(...tableLines);
    }

    lines.push("");
    return lines;
  }

  function buildTableRefreshLines(tableLines: string[]): string[] {
    if (tableLines.length === 0) {
      return [];
    }

    return ["", ...tableLines, ""];
  }

  function render(): void {
    if (!context || disabled) {
      return;
    }

    const metadataLines = buildRunMetadataSection({
      runId: context.runId,
      status: context.status,
      specPath: context.specPath,
      workspacePath: context.workspacePath,
      createdAt: formatRunTimestamp(context.createdAt),
      baseRevisionSha: context.baseRevisionSha,
    });

    const tableLines = buildAgentTable();
    const shouldIncludeTable = tableLines.length > 0;
    const interactiveLines = buildInteractiveLines(metadataLines, tableLines);

    if (stdout.isTTY) {
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
      return;
    }

    if (!metadataPrinted) {
      if (interactiveLines.length > 0) {
        stdout.write(interactiveLines.join("\n"));
      }
      metadataPrinted = true;
      return;
    }

    if (!shouldIncludeTable) {
      return;
    }

    const refreshLines = buildTableRefreshLines(tableLines);
    if (refreshLines.length > 0) {
      stdout.write(refreshLines.join("\n"));
    }
  }

  function buildAgentTable(): string[] {
    if (agentRecords.size === 0) {
      return [];
    }

    const rows: AgentRow[] = agentOrder
      .filter((agentId) => agentRecords.has(agentId))
      .map((agentId) => {
        const record = agentRecords.get(agentId)!;
        return {
          agentId: formatAgentBadge(agentId),
          status: formatAgentStatusLabel(record.status),
          elapsed: formatElapsed(record),
          diff: formatDiffCell(record.diffStatistics),
          evals: formatEvals(record),
        };
      });

    return renderTable({
      columns: [
        { header: "AGENT", accessor: (row) => row.agentId },
        { header: "STATUS", accessor: (row) => row.status },
        { header: "ELAPSED", accessor: (row) => row.elapsed },
        { header: "CHANGES", accessor: (row) => row.diff },
        { header: "EVALS", accessor: (row) => row.evals },
      ],
      rows,
    });
  }

  function formatDiffCell(value?: string): string {
    const compact = formatCompactDiffStatistics(value);
    if (compact) {
      return compact;
    }
    return value ?? DASH;
  }

  function formatElapsed(record: AgentInvocationRecord): string {
    if (!record.startedAt) {
      return DASH;
    }

    const started = Date.parse(record.startedAt);
    if (Number.isNaN(started)) {
      return DASH;
    }

    if (!record.completedAt && record.status === "running") {
      const elapsedMs = Math.max(0, now() - started);
      const formattedElapsed = formatDurationLabel(elapsedMs);
      return formattedElapsed ?? DASH;
    }

    if (!record.completedAt) {
      return DASH;
    }

    const formatted = formatAgentDuration({
      agentId: record.agentId,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    });

    if (formatted) {
      return formatted;
    }

    const completed = Date.parse(record.completedAt);
    if (Number.isNaN(completed)) {
      return DASH;
    }

    const elapsed = formatDurationLabel(Math.max(0, completed - started));
    return elapsed ?? DASH;
  }

  function formatEvals(record: AgentInvocationRecord): string {
    if (!record.evals || record.evals.length === 0) {
      return DASH;
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
    begin(beginContext?: RunProgressContext): void {
      guard(() => {
        if (!beginContext) {
          render();
          return;
        }
        context = { ...beginContext };
        render();
      });
    },
    update(record: AgentInvocationRecord): void {
      guard(() => {
        upsertRecord(record);
        render();
      });
    },
    complete(report: RunReport): string {
      let transcript = "";
      guard(() => {
        ensureFinalRender(report);

        disabled = true;
      });

      const hint = {
        message: `To review results:\n  voratiq review --run ${report.runId} --agent <agent-id>`,
      };

      const sections = stdout.isTTY
        ? undefined
        : buildRunTranscriptSections(report);

      transcript = renderTranscript({ sections, hint });
      return transcript;
    },
  };
}

export function buildRunTranscriptSections(report: RunReport): string[][] {
  const sections: string[][] = [];

  const headerLines: string[] = [];
  headerLines.push(`${report.runId} ${report.status.toUpperCase()}`);
  sections.push(headerLines);

  const agentLines: string[] = [];
  const sortedAgents = [...report.agents].sort((a, b) =>
    a.agentId.localeCompare(b.agentId),
  );

  for (const agent of sortedAgents) {
    agentLines.push(`  ${agent.agentId} ${agent.status.toUpperCase()}`);
  }

  if (agentLines.length > 0) {
    sections.push(agentLines);
  }

  return sections;
}

export type { RunProgressContext, RunProgressRenderer };
