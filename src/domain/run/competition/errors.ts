import { type PreflightIssue } from "../../../competition/shared/preflight.js";
import {
  formatOperatorPreflightIssueLines,
  resolveOperatorPreflightHintLines,
} from "../../../preflight/formatting.js";
import {
  DisplayableError,
  type HintedErrorOptions,
} from "../../../utils/errors.js";

export type { PreflightIssue } from "../../../competition/shared/preflight.js";

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
    const baseMessage = detail ?? "Agent process failed.";
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
    super(
      `Run directory already exists for run \`${runId}\`: \`${displayPath}\`.`,
      {
        hintLines: ["Remove the existing run directory and retry."],
      },
    );
  }
}

export class MissingAgentProviderError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(agentId: string) {
    super(`Agent \`${agentId}\` is missing a provider.`, {
      hintLines: ["Set `provider` for this agent in `agents.yaml`."],
    });
  }
}

export class UnknownAuthProviderError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(providerId: string) {
    super(`Unknown auth provider \`${providerId}\`.`, {
      hintLines: ["Use a provider configured by Voratiq."],
    });
  }
}

export class AuthProviderVerificationError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(detail: string) {
    super(detail, {
      hintLines: ["Authenticate this provider, then retry."],
    });
  }
}

export class AuthProviderStageError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor(detail: string) {
    super(detail, {
      hintLines: ["Verify provider credentials, then retry."],
    });
  }
}

export class RunPreflightError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;
  public readonly issues: readonly PreflightIssue[];

  constructor(
    issues: readonly PreflightIssue[],
    preProviderIssueCount: number = issues.length,
  ) {
    super("Preflight failed. Aborting run.", {
      detailLines: formatOperatorPreflightIssueLines(issues),
      hintLines:
        resolveOperatorPreflightHintLines(issues, preProviderIssueCount) ?? [],
    });
    this.issues = Array.from(issues);
    this.name = "RunPreflightError";
  }
}

export class NoAgentsEnabledError extends RunCommandError {
  public readonly kind = "workspace-setup" as const;

  constructor() {
    super("No agents are enabled in `agents.yaml`.", {
      hintLines: ["Set `enabled: true` on at least one agent."],
    });
  }
}

export class RunProcessStreamError extends RunCommandError {
  public readonly kind = "process-spawn" as const;

  constructor(detail: string) {
    super(detail, {
      hintLines: ["Inspect `stderr.log` to diagnose the failure."],
    });
    this.name = "RunProcessStreamError";
  }
}

export class RunReportInvariantError extends RunCommandError {
  public readonly kind = "run-report" as const;

  constructor(detail: string) {
    super(`Run report invariant violated: ${detail}`);
  }
}
