import type { PreflightIssue } from "../competition/shared/preflight.js";
import { loadRepoSettings } from "../configs/settings/loader.js";
import { toErrorMessage } from "../utils/errors.js";

const SETTINGS_ISSUE_AGENT_ID = "settings" as const;

export function collectSettingsPreflightIssues(
  root: string,
): readonly PreflightIssue[] {
  try {
    loadRepoSettings({ root });
    return [];
  } catch (error) {
    return [
      {
        agentId: SETTINGS_ISSUE_AGENT_ID,
        message: toErrorMessage(error),
      },
    ];
  }
}
