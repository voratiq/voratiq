import type { PruneResult } from "../../commands/prune/types.js";
import type { RunStatus } from "../../status/index.js";
import { colorize } from "../../utils/colors.js";
import { formatRunTimestamp } from "../utils/records.js";
import { buildRunMetadataSection } from "../utils/runs.js";
import { renderTranscript } from "../utils/transcript.js";

export interface PruneConfirmationPrefaceOptions {
  runId: string;
  specPath: string;
  runStatus: RunStatus;
  createdAt: string;
  runPath?: string;
  workspaces: readonly string[];
  directories: readonly string[];
  branches: readonly string[];
  purge: boolean;
  previouslyDeletedAt?: string;
}

export function buildPruneConfirmationPreface(
  options: PruneConfirmationPrefaceOptions,
): string[] {
  const {
    runId,
    specPath,
    runStatus,
    createdAt,
    runPath,
    workspaces,
    directories,
    branches,
    purge,
    previouslyDeletedAt,
  } = options;

  const introLines = buildRunMetadataSection({
    runId,
    specPath,
    status: runStatus,
    workspacePath: runPath,
    createdAt: formatRunTimestamp(createdAt),
  });

  const lines: string[] = ["", ...introLines];

  if (previouslyDeletedAt) {
    lines.push(
      `Marked deleted: ${previouslyDeletedAt}`,
      "Proceeding will update the deletion timestamp.",
    );
  }

  if (purge) {
    if (directories.length > 0) {
      lines.push("", "Directories to be deleted:");
      directories.forEach((directory) => lines.push(`  - ${directory}`));
    }
  } else if (workspaces.length > 0) {
    lines.push("", "Workspaces to be removed:");
    workspaces.forEach((workspace) => lines.push(`  - ${workspace}`));
  }

  if (branches.length > 0) {
    lines.push("", "Branches to be deleted:");
    branches.forEach((branch) => lines.push(`  - ${branch}`));
  }

  lines.push("");
  return lines;
}

export function renderPruneTranscript(result: PruneResult): string {
  if (result.status === "aborted") {
    const sections: string[][] = [
      [colorize("Prune aborted; no changes were made.", "yellow")],
    ];

    return renderTranscript({
      sections,
      hint: {
        message: `Re-run \`voratiq prune --run ${result.runId}\` when you are ready.`,
      },
    });
  }

  return renderTranscript({
    sections: [[colorize("Run pruned successfully.", "green")]],
  });
}
