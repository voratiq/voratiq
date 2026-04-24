import type { ExtractedTokenUsage } from "../../domain/run/model/types.js";
import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { TERMINAL_MESSAGE_STATUSES } from "../../status/index.js";
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
import {
  buildStandardSessionShellSection,
  formatTranscriptStatusLabel,
  renderTranscriptStatusTable,
  resolveTranscriptShellStyle,
  resolveTranscriptShellStyleFromWriter,
  type TranscriptShellStyleOptions,
} from "../utils/transcript-shell.js";

const DASH = "—";

export interface MessageProgressContext {
  messageId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workspacePath: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
}

export interface MessageProgressRecipientRecord {
  agentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  startedAt?: string;
  completedAt?: string;
  outputPath?: string;
  tokenUsage?: ExtractedTokenUsage;
  tokenUsageResult?: TokenUsageResult;
  error?: string | null;
}

export interface MessageProgressRenderer {
  begin(context?: MessageProgressContext): void;
  update(record: MessageProgressRecipientRecord): void;
  complete(
    status?: MessageProgressContext["status"],
    lifecycle?: { startedAt?: string; completedAt?: string },
  ): void;
}

export interface MessageTranscriptRecipientBlock {
  agentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  duration: string;
  outputPath?: string;
  previewLines?: readonly string[];
  errorLine?: string;
}

export interface MessageTranscriptOptions {
  messageId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  targetDisplay?: string;
  recipients: readonly MessageTranscriptRecipientBlock[];
  isTty?: boolean;
  includeSummarySection?: boolean;
  includeDetailSections?: boolean;
}

interface MessageRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

function buildMessageStageShell(options: {
  messageId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  tableLines?: string[];
  style?: TranscriptShellStyleOptions;
}): {
  metadataLines: string[];
  statusTableLines: string[];
} {
  return {
    metadataLines: buildStandardSessionShellSection({
      badgeText: options.messageId,
      badgeVariant: "message",
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

export function createMessageRenderer(
  options: MessageRendererOptions = {},
): MessageProgressRenderer {
  const stdout: CliWriter = options.stdout ?? process.stdout;
  const stderr: CliWriter = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now.bind(Date);
  const suppressLeadingBlankLine = options.suppressLeadingBlankLine === true;
  const suppressTrailingBlankLine = options.suppressTrailingBlankLine === true;

  let context: MessageProgressContext | undefined;
  let disabled = false;
  let warningLogged = false;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;
  const interactiveFrameRenderer = createInteractiveFrameRenderer(stdout);

  const recipientOrder: string[] = [];
  const recipientRecords = new Map<string, MessageProgressRecipientRecord>();

  function hasRunningRecipients(): boolean {
    for (const recipient of recipientRecords.values()) {
      if (recipient.status === "running") {
        return true;
      }
    }
    return false;
  }

  function syncRefreshLoop(): void {
    if (!stdout.isTTY || disabled || !context || !hasRunningRecipients()) {
      refreshInterval = clearRefreshIntervalHandle(refreshInterval);
      return;
    }
    if (refreshInterval) {
      return;
    }
    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context || !hasRunningRecipients()) {
          refreshInterval = clearRefreshIntervalHandle(refreshInterval);
          return;
        }
        const nextElapsed = formatMessageProgressElapsed(context, now());
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
          `[voratiq] Progressive message output disabled: ${formatProgressiveRenderErrorDetail(
            error,
          )}\n`,
        );
      }
    }
  }

  function formatDuration(record: MessageProgressRecipientRecord): string {
    return formatRenderLifecycleRowDuration({
      lifecycle: {
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
      terminalStatuses: TERMINAL_MESSAGE_STATUSES,
      now: now(),
    });
  }

  function syncContextLifecycleFromRecipientRecords(): void {
    if (!context) {
      return;
    }

    let earliestStartedAt = parseProgressTimestamp(context.startedAt);
    let latestCompletedAt = parseProgressTimestamp(context.completedAt);

    for (const recipient of recipientRecords.values()) {
      const startedAt = parseProgressTimestamp(recipient.startedAt);
      if (
        startedAt !== undefined &&
        (earliestStartedAt === undefined || startedAt < earliestStartedAt)
      ) {
        earliestStartedAt = startedAt;
      }

      const completedAt = parseProgressTimestamp(recipient.completedAt);
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

  function buildRecipientTable(style: TranscriptShellStyleOptions): string[] {
    if (recipientRecords.size === 0) {
      return [];
    }

    const resolvedStyle = resolveTranscriptShellStyle(style);
    const rows = recipientOrder
      .filter((agentId) => recipientRecords.has(agentId))
      .map((agentId) => {
        const recipient = recipientRecords.get(agentId)!;
        return {
          agentId: recipient.agentId,
          status: formatTranscriptStatusLabel(
            recipient.status,
            getAgentStatusStyle(recipient.status).cli,
            resolvedStyle,
          ),
          duration: formatDuration(recipient),
        };
      });

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

    syncContextLifecycleFromRecipientRecords();

    const style: TranscriptShellStyleOptions =
      resolveTranscriptShellStyleFromWriter(stdout, { forceTty: true });
    const elapsed = formatMessageProgressElapsed(context, now());
    lastElapsedLabel = elapsed ?? null;

    const shell = buildMessageStageShell({
      messageId: context.messageId,
      createdAt: context.createdAt,
      elapsed: elapsed ?? DASH,
      workspacePath: context.workspacePath,
      status: context.status,
      tableLines: buildRecipientTable(style),
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

  function upsertRecipient(record: MessageProgressRecipientRecord): void {
    if (!recipientOrder.includes(record.agentId)) {
      recipientOrder.push(record.agentId);
    }
    const existing = recipientRecords.get(record.agentId);
    recipientRecords.set(record.agentId, {
      ...existing,
      ...record,
      startedAt: record.startedAt ?? existing?.startedAt,
      completedAt: record.completedAt ?? existing?.completedAt,
      outputPath: record.outputPath ?? existing?.outputPath,
      tokenUsage: record.tokenUsage ?? existing?.tokenUsage,
      tokenUsageResult: record.tokenUsageResult ?? existing?.tokenUsageResult,
      error: record.error ?? existing?.error,
    });
  }

  return {
    begin(nextContext?: MessageProgressContext): void {
      guard(() => {
        if (!nextContext) {
          render();
          syncRefreshLoop();
          return;
        }
        context = { ...nextContext };
        render();
        syncRefreshLoop();
      });
    },
    update(record: MessageProgressRecipientRecord): void {
      guard(() => {
        upsertRecipient(record);
        render();
        syncRefreshLoop();
      });
    },
    complete(
      status?: MessageProgressContext["status"],
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

        if (context && status) {
          context = {
            ...context,
            status,
          };
        }
        render();
        disabled = true;
      });
    },
  };
}

export function renderMessageTranscript(
  options: MessageTranscriptOptions,
): string {
  const {
    recipients,
    isTty,
    includeSummarySection = true,
    includeDetailSections = true,
    targetDisplay,
  } = options;
  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);
  const sections: string[][] = [];

  if (includeSummarySection) {
    const metadataLines = buildStandardSessionShellSection({
      badgeText: options.messageId,
      badgeVariant: "message",
      status: {
        value: options.status,
        color: getRunStatusStyle(options.status).cli,
      },
      elapsed: options.elapsed,
      createdAt: options.createdAt,
      workspacePath: options.workspacePath,
      targetDisplay,
      style,
    });

    const shell = {
      metadataLines,
      statusTableLines:
        recipients.length > 0
          ? renderTranscriptStatusTable({
              rows: recipients,
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
    };

    sections.push(...buildStageFrameSections(shell));
  }

  if (includeDetailSections && recipients.length > 0) {
    sections.push(["---"]);
  }

  if (!includeDetailSections) {
    return renderTranscript({ sections });
  }

  recipients.forEach((recipient, index) => {
    const block: string[] = [`Agent: ${recipient.agentId}`];
    if (recipient.previewLines && recipient.previewLines.length > 0) {
      block.push("", ...recipient.previewLines);
    }
    if (recipient.errorLine) {
      const inlineError = recipient.errorLine.replace(/\s+/gu, " ").trim();
      block.push("", formatAgentErrorLine(inlineError, style));
    }
    block.push("", `Output: ${recipient.outputPath ?? DASH}`);
    if (index < recipients.length - 1) {
      block.push("", "---");
    }
    sections.push(block);
  });

  return renderTranscript({ sections });
}

export function formatMessageElapsed(input: {
  status: MessageProgressContext["status"];
  startedAt?: string;
  completedAt?: string;
  now?: number;
}): string | undefined {
  return formatRenderLifecycleDuration({
    lifecycle: {
      status: input.status,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    },
    terminalStatuses: TERMINAL_MESSAGE_STATUSES,
    now: input.now,
  });
}

export function formatMessageRecipientDuration(input: {
  status: MessageProgressRecipientRecord["status"];
  startedAt?: string;
  completedAt?: string;
  now?: number;
}): string {
  return formatRenderLifecycleRowDuration({
    lifecycle: {
      status: input.status,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    },
    terminalStatuses: ["succeeded", "failed", "aborted"],
    now: input.now,
  });
}

function formatMessageProgressElapsed(
  source: {
    status: MessageProgressContext["status"];
    startedAt?: string;
    completedAt?: string;
  },
  now?: number,
): string | undefined {
  return formatMessageElapsed({
    status: source.status,
    startedAt: source.startedAt,
    completedAt: source.completedAt,
    now,
  });
}
