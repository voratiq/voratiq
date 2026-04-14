import { CliError } from "../../cli/errors.js";
import type { PreflightIssue } from "../../competition/shared/preflight.js";
import {
  formatOperatorPreflightIssueLines,
  resolveOperatorPreflightHintLines,
} from "../../preflight/formatting.js";

export class SpecError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "SpecError";
  }
}

export class SpecAgentNotFoundError extends SpecError {
  constructor(public readonly agentId: string) {
    super(
      `Agent \`${agentId}\` not found in \`agents.yaml\`.`,
      [],
      ["Add this agent to `agents.yaml`."],
    );
    this.name = "SpecAgentNotFoundError";
  }
}

export class SpecGenerationFailedError extends SpecError {
  constructor(detailLines: readonly string[] = []) {
    super("Specification generation failed.", detailLines, [
      "Inspect `stderr.log` to diagnose the failure.",
    ]);
    this.name = "SpecGenerationFailedError";
  }
}

export class SpecPreflightError extends SpecError {
  public readonly issues: readonly PreflightIssue[];

  constructor(
    issues: readonly PreflightIssue[],
    preProviderIssueCount: number,
  ) {
    super(
      "Preflight failed. Aborting specification generation.",
      formatOperatorPreflightIssueLines(issues),
      resolveOperatorPreflightHintLines(issues, preProviderIssueCount) ?? [],
    );
    this.issues = Array.from(issues);
    this.name = "SpecPreflightError";
  }
}
