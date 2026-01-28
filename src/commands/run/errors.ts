import {
  DisplayableError,
  type HintedErrorOptions,
} from "../../utils/errors.js";

export type RunErrorKind =
  | "workspace-setup"
  | "agent-process"
  | "process-spawn"
  | "git-operation"
  | "run-report";

export abstract class RunCommandError extends DisplayableError {
  public abstract readonly kind: RunErrorKind;

  constructor(message: string, options: HintedErrorOptions = {}) {
    super(message, options);
  }
}

export class WorkspaceSetupRunError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(detail: string, options: HintedErrorOptions = {}) {
    super(detail, options);
  }
}

export interface AgentProcessErrorOptions {
  exitCode?: number | null;
  detail?: string;
}

export class AgentProcessError extends RunCommandError {
  public readonly kind = "agent-process" as const;

  constructor(options: AgentProcessErrorOptions = {}) {
    const { detail, exitCode } = options;
    const baseMessage =
      detail ?? "Agent process failed. Please review the logs.";
    const formattedMessage =
      typeof exitCode === "number"
        ? `${baseMessage} (exit code ${exitCode})`
        : baseMessage;
    super(formattedMessage);
  }
}

export interface GitOperationErrorOptions {
  operation: string;
  detail: string;
}

export class GitOperationError extends RunCommandError {
  public readonly kind = "git-operation" as const;
  private readonly operation: string;
  private readonly detail: string;

  constructor(options: GitOperationErrorOptions) {
    const { operation, detail } = options;
    super(`${operation}: ${detail}`);
    this.operation = operation;
    this.detail = detail;
  }

  public override messageForDisplay(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export class RunDirectoryExistsError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(runId: string, displayPath: string) {
    super(`Run directory already exists for id ${runId}: ${displayPath}`);
  }
}

export class MissingAgentProviderError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(agentId: string) {
    super(`Agent "${agentId}" missing provider.`);
  }
}

export class UnknownAuthProviderError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(providerId: string) {
    super(`Unknown auth provider "${providerId}".`);
  }
}

export class AuthProviderVerificationError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(detail: string) {
    super(detail);
  }
}

export class AuthProviderStageError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(detail: string) {
    super(detail);
  }
}

export interface PreflightIssue {
  readonly agentId: string;
  readonly message: string;
}

const PREFLIGHT_SUMMARY_MAX_CHARS = 120 as const;
const PREFLIGHT_HINT =
  "Run `voratiq init` to configure the workspace." as const;

export class RunPreflightError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;
  public readonly issues: readonly PreflightIssue[];

  constructor(issues: readonly PreflightIssue[]) {
    super("Preflight failed. Aborting run.", {
      detailLines: formatPreflightIssueLines(issues),
      hintLines: [PREFLIGHT_HINT],
    });
    this.issues = Array.from(issues);
    this.name = "RunPreflightError";
  }
}

export class NoAgentsEnabledError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor() {
    super(
      "No agents enabled in `.voratiq/agents.yaml`. Set `enabled: true` on at least one agent.",
    );
  }
}

export class RunProcessStreamError extends RunCommandError {
  public readonly kind = "process-spawn" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "RunProcessStreamError";
  }
}

export class RunReportInvariantError extends RunCommandError {
  public readonly kind = "run-report" as const;

  constructor(detail: string) {
    super(`Run report invariant violated: ${detail}`);
  }
}

function formatPreflightIssueLines(
  issues: readonly PreflightIssue[],
): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const messageLines = normalizeIssueMessage(issue.message);
    for (const message of messageLines) {
      const full = `- ${issue.agentId}: ${message}`;
      lines.push(truncateLine(full, PREFLIGHT_SUMMARY_MAX_CHARS));
    }
  }
  return lines;
}

function normalizeIssueMessage(message: string): string[] {
  const split = message
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  return split.length > 0 ? split : ["unknown error"];
}

function truncateLine(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const suffix = "...";
  if (maxChars <= suffix.length) {
    return suffix.slice(0, maxChars);
  }

  const sliceLength = maxChars - suffix.length;
  return `${value.slice(0, sliceLength).trimEnd()}${suffix}`;
}
