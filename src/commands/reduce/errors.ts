import { CliError } from "../../cli/errors.js";
import {
  formatPreflightIssueLines,
  PREFLIGHT_HINT,
  type PreflightIssue,
} from "../../competition/shared/preflight.js";

export type ReducePreflightIssue = PreflightIssue;

export class ReduceError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines?: readonly string[],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "ReduceError";
  }
}

export class ReduceAgentNotFoundError extends ReduceError {
  constructor(public readonly agentId: string) {
    super(
      `Agent \`${agentId}\` not found in \`agents.yaml\`.`,
      [],
      ["Add this agent to `agents.yaml`."],
    );
    this.name = "ReduceAgentNotFoundError";
  }
}

export class ReducePreflightError extends ReduceError {
  public readonly issues: readonly ReducePreflightIssue[];

  constructor(
    issues: readonly ReducePreflightIssue[],
    hintLines: readonly string[] = [PREFLIGHT_HINT],
  ) {
    super(
      "Preflight failed. Aborting reduction.",
      formatPreflightIssueLines(issues),
      hintLines,
    );
    this.issues = Array.from(issues);
    this.name = "ReducePreflightError";
  }
}

export class ReduceGenerationFailedError extends ReduceError {
  constructor(detailLines: readonly string[] = []) {
    super("Reduction failed.", detailLines, [
      "Inspect reducer stderr logs to diagnose the failure.",
    ]);
    this.name = "ReduceGenerationFailedError";
  }
}
