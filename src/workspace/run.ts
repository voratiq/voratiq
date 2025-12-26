import { mkdir } from "node:fs/promises";

import { RunDirectoryExistsError } from "../commands/run/errors.js";
import { pathExists } from "../utils/fs.js";
import { normalizePathForDisplay, relativeToRoot } from "../utils/path.js";
import type { RunWorkspacePaths } from "./layout.js";
import { resolveRunWorkspacePaths } from "./layout.js";

export interface RunWorkspaceSetupResult {
  readonly runWorkspace: RunWorkspacePaths;
}

export interface WorkspaceSetupInput {
  readonly root: string;
  readonly runId: string;
}

/**
 * Prepare run workspace directory.
 */
export async function prepareRunWorkspace(
  input: WorkspaceSetupInput,
): Promise<RunWorkspaceSetupResult> {
  const { root, runId } = input;

  const runWorkspace = resolveRunWorkspacePaths(root, runId);
  const runRoot = runWorkspace.absolute;

  if (await pathExists(runRoot)) {
    const displayPath = normalizePathForDisplay(relativeToRoot(root, runRoot));
    throw new RunDirectoryExistsError(runId, displayPath);
  }

  await mkdir(runRoot, { recursive: true });

  return { runWorkspace };
}
