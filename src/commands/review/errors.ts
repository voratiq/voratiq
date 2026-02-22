import { CliError } from "../../cli/errors.js";

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
      `Agent "${agentId}" not found in agents.yaml.`,
      [],
      ["To add this agent, edit `.voratiq/agents.yaml`."],
    );
    this.name = "ReviewAgentNotFoundError";
  }
}

export class ReviewGenerationFailedError extends ReviewError {
  constructor(
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super("Review generation failed.", detailLines, hintLines);
    this.name = "ReviewGenerationFailedError";
  }
}

export class ReviewNoEligibleCandidatesError extends ReviewError {
  constructor() {
    super("Review generation failed. No eligible candidates to review.");
    this.name = "ReviewNoEligibleCandidatesError";
  }
}

export interface ReviewPreflightIssue {
  readonly agentId: string;
  readonly message: string;
}

const PREFLIGHT_SUMMARY_MAX_CHARS = 120 as const;
const PREFLIGHT_HINT =
  "Run `voratiq init` to configure the workspace." as const;

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

function formatPreflightIssueLines(
  issues: readonly ReviewPreflightIssue[],
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
