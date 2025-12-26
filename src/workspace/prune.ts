import { rm } from "node:fs/promises";

import type { RunRecord } from "../records/types.js";
import { formatErrorMessage } from "../utils/output.js";
import { relativeToRoot, resolvePath } from "../utils/path.js";
import { WorkspaceSetupError } from "./errors.js";
import {
  getAgentSessionWorkspaceDirectoryPath,
  getSessionDirectoryPath,
} from "./structure.js";

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

export async function removeSessionDirectory(options: {
  root: string;
  domain: string;
  sessionId: string;
}): Promise<void> {
  const { root, domain, sessionId } = options;
  const relativePath = getSessionDirectoryPath(domain, sessionId);
  const absolutePath = resolvePath(root, relativePath);
  await removeWorkspaceEntry({ path: absolutePath, root, recursive: true });
}

export async function removeAgentWorkspaceDirectory(options: {
  root: string;
  domain: string;
  sessionId: string;
  agentId: string;
}): Promise<void> {
  const { root, domain, sessionId, agentId } = options;
  const relativePath = getAgentSessionWorkspaceDirectoryPath(
    domain,
    sessionId,
    agentId,
  );
  const absolutePath = resolvePath(root, relativePath);
  await removeWorkspaceEntry({ path: absolutePath, root, recursive: true });
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
