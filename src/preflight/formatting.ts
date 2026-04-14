import {
  formatPreflightIssueLines,
  PREFLIGHT_HINT,
  type PreflightIssue,
} from "../competition/shared/preflight.js";

export const OPERATOR_PREFLIGHT_UNLABELED_AGENT_IDS = ["settings"] as const;
export const SETTINGS_PREFLIGHT_HINT =
  "Review `settings.yaml` and correct invalid values." as const;

export function formatOperatorPreflightIssueLines(
  issues: readonly PreflightIssue[],
): string[] {
  return formatPreflightIssueLines(issues, {
    unlabeledAgentIds: OPERATOR_PREFLIGHT_UNLABELED_AGENT_IDS,
  });
}

export function resolveOperatorPreflightHintLines(
  issues: readonly PreflightIssue[],
  preProviderIssueCount: number,
): readonly string[] | undefined {
  const preProviderIssues = issues.slice(0, preProviderIssueCount);
  const hasSettingsIssue = preProviderIssues.some(
    (issue) => issue.agentId === "settings",
  );
  const hasRepairableWorkspaceIssue = preProviderIssues.some(
    (issue) => issue.agentId !== "settings",
  );

  if (hasSettingsIssue) {
    return [SETTINGS_PREFLIGHT_HINT];
  }
  if (hasRepairableWorkspaceIssue) {
    return [PREFLIGHT_HINT];
  }

  return [];
}
