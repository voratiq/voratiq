import { CliError } from "../../cli/errors.js";

export class ReduceError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
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

export interface ReducePreflightIssue {
  readonly agentId: string;
  readonly message: string;
}

const PREFLIGHT_SUMMARY_MAX_CHARS = 120 as const;
const PREFLIGHT_HINT =
  "Run `voratiq init` to configure the workspace." as const;

export class ReducePreflightError extends ReduceError {
  public readonly issues: readonly ReducePreflightIssue[];

  constructor(issues: readonly ReducePreflightIssue[]) {
    super(
      "Preflight failed. Aborting reduction.",
      formatPreflightIssueLines(issues),
      [PREFLIGHT_HINT],
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

function formatPreflightIssueLines(
  issues: readonly ReducePreflightIssue[],
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
