import type { ExtractedTokenUsage } from "../../domain/run/model/types.js";
import { getRunStatusStyle } from "../../status/colors.js";
import { TERMINAL_VERIFICATION_STATUSES } from "../../status/index.js";
import type { TokenUsageResult } from "../../workspace/chat/token-usage-result.js";
import { formatRenderLifecycleDuration } from "../utils/duration.js";
import { createInteractiveFrameRenderer } from "../utils/interactive-frame.js";
import {
  buildStageFrameLines,
  buildStageFrameSections,
} from "../utils/stage-output.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";
import type { TranscriptShellStyleOptions } from "../utils/transcript-shell.js";
import {
  buildStandardSessionShellSection,
  formatTranscriptErrorLine,
  formatTranscriptStatusLabel,
  resolveTranscriptShellStyle,
  resolveTranscriptShellStyleFromWriter,
} from "../utils/transcript-shell.js";
import type { StageProgressEventConsumer } from "./stage-progress.js";

type CliWriter = Pick<NodeJS.WriteStream, "write"> & {
  isTTY?: boolean;
  columns?: number;
};

const DASH = "—";
type VerifyTranscriptStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "aborted"
  | "unresolved";
const VERIFY_TRANSCRIPT_TERMINAL_STATUSES = [
  ...TERMINAL_VERIFICATION_STATUSES,
  "unresolved",
] as const;

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

export interface VerifyProgressContext {
  verificationId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workspacePath: string;
  status: VerifyTranscriptStatus;
}

export interface VerifyProgressMethodRecord {
  methodKey: string;
  verifierLabel: string;
  agentLabel?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  startedAt?: string;
  completedAt?: string;
  artifactPath?: string;
  tokenUsage?: ExtractedTokenUsage;
  tokenUsageResult?: TokenUsageResult;
}

interface VerifyRendererOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
  now?: () => number;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
}

export interface VerifyProgressRenderer extends StageProgressEventConsumer<
  VerifyProgressContext,
  VerifyProgressMethodRecord
> {
  begin(context?: VerifyProgressContext): void;
  update(record: VerifyProgressMethodRecord): void;
  complete(
    status?: VerifyTranscriptStatus,
    lifecycle?: { startedAt?: string; completedAt?: string },
  ): void;
}

export interface VerifyTranscriptMethodBlock {
  verifierLabel: string;
  agentLabel?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  duration: string;
  artifactPath?: string;
  bodyLines?: readonly string[];
  errorLine?: string;
}

function buildVerifyStageShell(options: {
  verificationId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: VerifyTranscriptStatus;
  targetDisplay?: string;
  tableLines?: string[];
  style?: TranscriptShellStyleOptions;
}): {
  metadataLines: string[];
  statusTableLines: string[];
} {
  const metadataLines = buildStandardSessionShellSection({
    badgeText: options.verificationId,
    badgeVariant: "verify",
    status: {
      value: options.status,
      color:
        options.status === "unresolved"
          ? "yellow"
          : getRunStatusStyle(options.status).cli,
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

function buildVerifyMethodTable<
  Row extends {
    verifierLabel: string;
    agentLabel?: string;
    status: string;
    duration: string;
  },
>(rows: readonly Row[]): string[] {
  return renderTable({
    columns: [
      {
        header: "AGENT",
        accessor: (row) => row.agentLabel ?? DASH,
      },
      {
        header: "VERIFIER",
        accessor: (row) => row.verifierLabel,
      },
      {
        header: "STATUS",
        accessor: (row) => row.status,
      },
      {
        header: "DURATION",
        accessor: (row) => row.duration,
      },
    ],
    rows,
  });
}

function formatVerifierLabel(
  verifierLabel: string,
  status: VerifyProgressMethodRecord["status"],
  style: TranscriptShellStyleOptions,
): string {
  void status;
  void style;
  return verifierLabel;
}

export function createVerifyRenderer(
  options: VerifyRendererOptions = {},
): VerifyProgressRenderer {
  const stdout: CliWriter = options.stdout ?? process.stdout;
  const stderr: CliWriter = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now.bind(Date);
  const suppressLeadingBlankLine = options.suppressLeadingBlankLine === true;
  const suppressTrailingBlankLine = options.suppressTrailingBlankLine === true;

  let context: VerifyProgressContext | undefined;
  let disabled = false;
  let warningLogged = false;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let lastElapsedLabel: string | null = null;
  const interactiveFrameRenderer = createInteractiveFrameRenderer(stdout);

  const methodOrder: string[] = [];
  const methodRecords = new Map<string, VerifyProgressMethodRecord>();

  function stopRefreshLoop(): void {
    if (!refreshInterval) {
      return;
    }

    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }

  function hasRunningMethods(): boolean {
    for (const method of methodRecords.values()) {
      if (method.status === "running") {
        return true;
      }
    }
    return false;
  }

  function syncRefreshLoop(): void {
    if (!stdout.isTTY || disabled || !context || !hasRunningMethods()) {
      stopRefreshLoop();
      return;
    }

    if (refreshInterval) {
      return;
    }

    refreshInterval = setInterval(() => {
      guard(() => {
        if (!stdout.isTTY || disabled || !context || !hasRunningMethods()) {
          stopRefreshLoop();
          return;
        }

        const nextElapsed = formatVerifyElapsed(context, now());
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
          `[voratiq] Progressive verify output disabled: ${formatErrorDetail(error)}\n`,
        );
      }
    }
  }

  function safeParse(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  function formatDuration(record: VerifyProgressMethodRecord): string {
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
        terminalStatuses: TERMINAL_VERIFICATION_STATUSES,
        now: now(),
      }) ?? DASH
    );
  }

  function syncContextLifecycleFromMethods(): void {
    if (!context) {
      return;
    }

    let earliestStartedAt = safeParse(context.startedAt);
    let latestCompletedAt = safeParse(context.completedAt);

    for (const method of methodRecords.values()) {
      const startedAt = safeParse(method.startedAt);
      if (
        startedAt !== undefined &&
        (earliestStartedAt === undefined || startedAt < earliestStartedAt)
      ) {
        earliestStartedAt = startedAt;
      }

      const completedAt = safeParse(method.completedAt);
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

  function buildMethodTable(style: TranscriptShellStyleOptions): string[] {
    if (methodRecords.size === 0) {
      return [];
    }

    const resolvedStyle = resolveTranscriptShellStyle(style);
    const rows = methodOrder
      .filter((methodKey) => methodRecords.has(methodKey))
      .map((methodKey) => {
        const method = methodRecords.get(methodKey)!;
        return {
          verifierLabel: formatVerifierLabel(
            method.verifierLabel,
            method.status,
            resolvedStyle,
          ),
          agentLabel: method.agentLabel,
          status: formatTranscriptStatusLabel(
            method.status,
            getRunStatusStyle(method.status).cli,
            resolvedStyle,
          ),
          duration: formatDuration(method),
          artifactPath: method.artifactPath,
        };
      });

    return buildVerifyMethodTable(rows);
  }

  function render(): void {
    if (!context || disabled || !stdout.isTTY) {
      return;
    }

    syncContextLifecycleFromMethods();
    const style: TranscriptShellStyleOptions =
      resolveTranscriptShellStyleFromWriter(stdout, { forceTty: true });
    const elapsed = formatVerifyElapsed(context, now());
    lastElapsedLabel = elapsed ?? null;

    const shell = buildVerifyStageShell({
      verificationId: context.verificationId,
      createdAt: context.createdAt,
      elapsed: elapsed ?? DASH,
      workspacePath: context.workspacePath,
      status: context.status,
      tableLines: buildMethodTable(style),
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

  function upsertMethod(record: VerifyProgressMethodRecord): void {
    if (!methodOrder.includes(record.methodKey)) {
      methodOrder.push(record.methodKey);
    }
    const existing = methodRecords.get(record.methodKey);
    methodRecords.set(record.methodKey, {
      ...existing,
      ...record,
      startedAt: record.startedAt ?? existing?.startedAt,
      completedAt: record.completedAt ?? existing?.completedAt,
      artifactPath: record.artifactPath ?? existing?.artifactPath,
    });
  }

  return {
    onProgressEvent(event): void {
      guard(() => {
        if (event.stage !== "verify") {
          return;
        }

        if (event.type === "stage.begin") {
          context = { ...event.context };
          render();
          syncRefreshLoop();
          return;
        }

        if (event.type === "stage.candidate") {
          upsertMethod(event.candidate);
          render();
          syncRefreshLoop();
          return;
        }

        if (!context) {
          return;
        }

        context = {
          ...context,
          status: event.status as VerifyProgressContext["status"],
        };
        render();
        syncRefreshLoop();
      });
    },
    begin(nextContext?: VerifyProgressContext): void {
      guard(() => {
        if (!nextContext) {
          render();
          syncRefreshLoop();
          return;
        }
        this.onProgressEvent({
          type: "stage.begin",
          stage: "verify",
          context: nextContext,
        });
      });
    },
    update(record: VerifyProgressMethodRecord): void {
      this.onProgressEvent({
        type: "stage.candidate",
        stage: "verify",
        candidate: record,
      });
    },
    complete(
      status?: VerifyTranscriptStatus,
      lifecycle?: { startedAt?: string; completedAt?: string },
    ): void {
      stopRefreshLoop();
      const allowTerminalOverride =
        disabled &&
        stdout.isTTY === true &&
        context !== undefined &&
        status !== undefined &&
        context.status !== status;
      if (disabled && !allowTerminalOverride) {
        return;
      }
      if (allowTerminalOverride) {
        disabled = false;
      }
      guard(() => {
        if (context && lifecycle) {
          context = {
            ...context,
            startedAt: lifecycle.startedAt ?? context.startedAt,
            completedAt: lifecycle.completedAt ?? context.completedAt,
          };
        }

        if (status) {
          if (context) {
            context = { ...context, status };
          }
          render();
          syncRefreshLoop();
        } else {
          render();
        }

        disabled = true;
      });
    },
  };
}

export function renderVerifyTranscript(options: {
  verificationId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  targetDisplay?: string;
  target?: {
    kind: string;
    sessionId: string;
  };
  status: VerifyTranscriptStatus;
  methods: readonly VerifyTranscriptMethodBlock[];
  suppressHint?: boolean;
  warningMessage?: string;
  hintMessage?: string;
  isTty?: boolean;
  includeSummarySection?: boolean;
}): string {
  const {
    verificationId,
    createdAt,
    elapsed,
    workspacePath,
    targetDisplay,
    target,
    status,
    methods,
    suppressHint,
    warningMessage,
    hintMessage,
    isTty,
    includeSummarySection = true,
  } = options;

  const style: TranscriptShellStyleOptions = { isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);
  const sections: string[][] = [];
  const resolvedTargetDisplay =
    targetDisplay ??
    (target ? `${target.kind}:${target.sessionId}` : undefined);

  if (includeSummarySection) {
    const metadataLines = buildVerifyStageShell({
      verificationId,
      createdAt,
      elapsed,
      workspacePath,
      status,
      targetDisplay: resolvedTargetDisplay,
      tableLines:
        methods.length === 0
          ? []
          : buildVerifyMethodTable(
              methods.map((method) => ({
                verifierLabel: formatVerifierLabel(
                  method.verifierLabel,
                  method.status,
                  resolvedStyle,
                ),
                agentLabel: method.agentLabel,
                status: formatTranscriptStatusLabel(
                  method.status,
                  getRunStatusStyle(method.status).cli,
                  resolvedStyle,
                ),
                duration: method.duration,
                artifactPath: method.artifactPath,
              })),
            ),
      style,
    });

    sections.push(...buildStageFrameSections(metadataLines));
  }

  if (methods.length > 0) {
    sections.push(["---"]);
  }

  methods.forEach((method, index) => {
    const block: string[] = [`Agent: ${method.agentLabel ?? DASH}`];

    block.push("", `Verifier: ${method.verifierLabel}`);

    if (method.bodyLines && method.bodyLines.length > 0) {
      block.push("", ...method.bodyLines);
    }

    if (method.errorLine) {
      block.push("");
      block.push(formatTranscriptErrorLine(method.errorLine, resolvedStyle));
    }

    block.push("", `Output: ${method.artifactPath ?? DASH}`);

    if (index < methods.length - 1) {
      block.push("", "---");
    }

    sections.push(block);
  });

  const footerParts = [
    ...(warningMessage ? [warningMessage] : []),
    ...(hintMessage && !suppressHint ? [hintMessage] : []),
  ];

  const hint =
    footerParts.length === 0
      ? undefined
      : {
          message: `---\n\n${footerParts.join("\n\n---\n\n")}`,
        };

  return renderTranscript({ sections, hint });
}

export function formatVerifyElapsed(
  source: {
    status: VerifyProgressContext["status"];
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
    terminalStatuses: VERIFY_TRANSCRIPT_TERMINAL_STATUSES,
    now,
  });
}
