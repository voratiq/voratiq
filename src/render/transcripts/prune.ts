import type {
  PruneAllResult,
  PruneResult,
} from "../../commands/prune/types.js";
import type { RunRecord } from "../../runs/records/types.js";
import type { RunStatus } from "../../status/index.js";
import { colorize } from "../../utils/colors.js";
import { formatRunTimestamp } from "../utils/records.js";
import { buildRunMetadataSection } from "../utils/runs.js";
import { renderBlocks, renderTranscript } from "../utils/transcript.js";
import { renderRunList } from "./list.js";

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

  const sections: string[][] = [];
  const summaryLines = [...introLines];
  if (previouslyDeletedAt) {
    summaryLines.push(
      `Marked deleted: ${previouslyDeletedAt}`,
      "Proceeding will update the deletion timestamp.",
    );
  }
  if (summaryLines.length > 0) {
    sections.push(summaryLines);
  }

  if (purge) {
    if (directories.length > 0) {
      sections.push([
        "Directories to be deleted:",
        ...directories.map((directory) => `  - ${directory}`),
      ]);
    }
  } else if (workspaces.length > 0) {
    sections.push([
      "Workspaces to be removed:",
      ...workspaces.map((workspace) => `  - ${workspace}`),
    ]);
  }

  if (branches.length > 0) {
    sections.push([
      "Branches to be deleted:",
      ...branches.map((branch) => `  - ${branch}`),
    ]);
  }

  return renderBlocks({
    sections,
    leadingBlankLine: true,
    trailingBlankLine: true,
  });
}

export interface PruneAllConfirmationPrefaceOptions {
  records: readonly RunRecord[];
}

export function buildPruneAllConfirmationPreface(
  options: PruneAllConfirmationPrefaceOptions,
): string[] {
  const { records } = options;
  const tableOutput = renderRunList(records);
  const sections: string[][] = [];

  if (tableOutput.trim().length > 0) {
    sections.push(tableOutput.split("\n"));
  }

  const runLabel = records.length === 1 ? "run" : "runs";
  sections.push([`${records.length} ${runLabel} to prune.`]);

  return renderBlocks({
    sections,
    leadingBlankLine: true,
    trailingBlankLine: true,
  });
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

export function renderPruneAllTranscript(result: PruneAllResult): string {
  if (result.status === "noop") {
    return renderTranscript({
      sections: [["No runs to prune."]],
    });
  }

  if (result.status === "aborted") {
    return renderTranscript({
      sections: [[colorize("Prune aborted; no changes were made.", "yellow")]],
      hint: {
        message: "Re-run `voratiq prune --all` when you are ready.",
      },
    });
  }

  return renderTranscript({
    sections: [[colorize("Runs pruned successfully.", "green")]],
  });
}
