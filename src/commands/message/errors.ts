import { CliError } from "../../cli/errors.js";
import type { PreflightIssue } from "../../competition/shared/preflight.js";
import {
  formatOperatorPreflightIssueLines,
  resolveOperatorPreflightHintLines,
} from "../../preflight/formatting.js";

export class MessageError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "MessageError";
  }
}

export class MessageAgentNotFoundError extends MessageError {
  constructor(agentId: string) {
    super(`Message agent not found: ${agentId}`);
    this.name = "MessageAgentNotFoundError";
  }
}

export class MessageGenerationFailedError extends MessageError {
  constructor(details: readonly string[]) {
    super(
      details.length > 0
        ? `Message execution failed: ${details.join("; ")}`
        : "Message execution failed.",
    );
    this.name = "MessageGenerationFailedError";
  }
}

export class MessagePreflightError extends MessageError {
  public readonly issues: readonly PreflightIssue[];

  constructor(
    issues: readonly PreflightIssue[],
    preProviderIssueCount: number,
  ) {
    super(
      "Preflight failed. Aborting message.",
      formatOperatorPreflightIssueLines(issues),
      resolveOperatorPreflightHintLines(issues, preProviderIssueCount) ?? [],
    );
    this.issues = Array.from(issues);
    this.name = "MessagePreflightError";
  }
}

export class MessageInvocationContextError extends MessageError {
  constructor() {
    super("`message` cannot be invoked from inside a batch agent workspace.");
    this.name = "MessageInvocationContextError";
  }
}
