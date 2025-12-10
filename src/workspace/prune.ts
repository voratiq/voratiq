import { rm } from "node:fs/promises";

import type { RunRecord } from "../records/types.js";
import { formatErrorMessage } from "../utils/output.js";
import { relativeToRoot } from "../utils/path.js";
import { WorkspaceSetupError } from "./errors.js";

export async function removeWorkspaceEntry(options: {
  path: string;
  root: string;
  recursive?: boolean;
}): Promise<void> {
  const { path, root, recursive = false } = options;

  try {
    await rm(path, { recursive, force: false });
  } catch (error) {
    const displayPath = relativeToRoot(root, path);
    throw new WorkspaceSetupError(
      formatErrorMessage(
        `Failed to remove ${displayPath}: ${(error as Error).message}`,
      ),
    );
  }
}

export async function removeRunDirectory(
  path: string,
  root: string,
): Promise<void> {
  await removeWorkspaceEntry({ path, root, recursive: true });
}

export function deriveAgentBranches(runRecord: RunRecord): string[] {
  const seen = new Set<string>();
  const branches: string[] = [];

  for (const agent of runRecord.agents) {
    const branch = `voratiq/run/${runRecord.runId}/${agent.agentId}`;
    if (!seen.has(branch)) {
      seen.add(branch);
      branches.push(branch);
    }
  }

  return branches.sort((a, b) => a.localeCompare(b));
}
