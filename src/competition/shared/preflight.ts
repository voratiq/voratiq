export interface PreflightIssue {
  readonly agentId: string;
  readonly message: string;
}

export interface FormatPreflightIssueLinesOptions {
  readonly maxChars?: number;
  readonly unlabeledAgentIds?: readonly string[];
}

export const PREFLIGHT_SUMMARY_MAX_CHARS = 120 as const;

export const PREFLIGHT_HINT =
  "Run `voratiq doctor --fix` to repair workspace setup." as const;

const SETTINGS_FILE_MESSAGE_PATTERN =
  /^Invalid settings file at (?:(?:.+\/)?(?:\.voratiq\/)?)settings\.yaml(?::\s*(.+))?$/u;

export function formatPreflightIssueLines(
  issues: readonly PreflightIssue[],
  options: FormatPreflightIssueLinesOptions = {},
): string[] {
  const { maxChars = PREFLIGHT_SUMMARY_MAX_CHARS, unlabeledAgentIds = [] } =
    options;
  const unlabeled = new Set(unlabeledAgentIds);
  const lines: string[] = [];

  for (const issue of issues) {
    const messageLines = normalizeIssueMessage(issue.message);
    for (const message of messageLines) {
      const full = formatIssueLine(issue.agentId, message, unlabeled);
      lines.push(truncateLine(full, maxChars));
    }
  }

  return lines;
}

function formatIssueLine(
  agentId: string,
  message: string,
  unlabeledAgentIds: ReadonlySet<string>,
): string {
  if (unlabeledAgentIds.has(agentId)) {
    return `- ${message}`;
  }
  return `- \`${agentId}\`: ${message}`;
}

function normalizeIssueMessage(message: string): string[] {
  const split = message
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .map(normalizeIssueText)
    .filter((line) => line.length > 0);
  return split.length > 0 ? split : ["unknown error"];
}

function normalizeIssueText(line: string): string {
  const settingsMatch = SETTINGS_FILE_MESSAGE_PATTERN.exec(line);
  if (!settingsMatch) {
    return line;
  }

  const detail = settingsMatch[1]?.trim();
  if (!detail) {
    return "Invalid `settings.yaml`.";
  }

  return `Invalid \`settings.yaml\`: ${detail}`;
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
