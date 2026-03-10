import { CliError } from "../../../cli/errors.js";
import {
  formatPreflightIssueLines,
  PREFLIGHT_HINT,
  type PreflightIssue,
} from "../../../competition/shared/preflight.js";

export type ReviewPreflightIssue = PreflightIssue;

export class ReviewError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "ReviewError";
  }
}

export class ReviewAgentNotFoundError extends ReviewError {
  constructor(public readonly agentId: string) {
    super(
      `Agent \`${agentId}\` not found in \`agents.yaml\`.`,
      [],
      ["Add this agent to `agents.yaml`."],
    );
    this.name = "ReviewAgentNotFoundError";
  }
}

export class ReviewGenerationFailedError extends ReviewError {
  constructor(
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    const normalizedHint =
      hintLines[0] ?? "Inspect `stderr.log` to diagnose the failure.";
    super("Review generation failed.", detailLines, [normalizedHint]);
    this.name = "ReviewGenerationFailedError";
  }
}

export class ReviewNoEligibleCandidatesError extends ReviewError {
  constructor() {
    super(
      "No eligible candidates available for review.",
      [],
      ["At least one agent must produce a diff."],
    );
    this.name = "ReviewNoEligibleCandidatesError";
  }
}

export class ReviewPreflightError extends ReviewError {
  public readonly issues: readonly ReviewPreflightIssue[];

  constructor(issues: readonly ReviewPreflightIssue[]) {
    super(
      "Preflight failed. Aborting review.",
      formatPreflightIssueLines(issues),
      [PREFLIGHT_HINT],
    );
    this.issues = Array.from(issues);
    this.name = "ReviewPreflightError";
  }
}
