import { CliError } from "../../cli/errors.js";
import type { PreflightIssue } from "../../competition/shared/preflight.js";
import {
  formatOperatorPreflightIssueLines,
  resolveOperatorPreflightHintLines,
} from "../../preflight/formatting.js";

export class VerifyError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "VerifyError";
  }
}

export class VerifyAgentNotFoundError extends VerifyError {
  constructor(agentId: string) {
    super(`Verifier agent not found: ${agentId}`);
    this.name = "VerifyAgentNotFoundError";
  }
}

export class VerifyPreflightError extends VerifyError {
  public readonly issues: readonly PreflightIssue[];

  constructor(
    issues: readonly PreflightIssue[],
    preProviderIssueCount: number,
  ) {
    super(
      "Preflight failed. Aborting verification.",
      formatOperatorPreflightIssueLines(issues),
      resolveOperatorPreflightHintLines(issues, preProviderIssueCount) ?? [],
    );
    this.issues = Array.from(issues);
    this.name = "VerifyPreflightError";
  }
}
