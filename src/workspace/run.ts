import { mkdir, writeFile } from "node:fs/promises";

import { RunDirectoryExistsError } from "../commands/run/errors.js";
import { pathExists } from "../utils/fs.js";
import { normalizePathForDisplay, relativeToRoot } from "../utils/path.js";
import { cleanupRunWorkspace } from "./cleanup.js";
import type { RunWorkspacePaths } from "./layout.js";
import { resolveRunPromptPath, resolveRunWorkspacePaths } from "./layout.js";

export interface RunWorkspaceSetupResult {
  readonly runWorkspace: RunWorkspacePaths;
  readonly prompt: string;
}

export interface WorkspaceSetupInput {
  readonly root: string;
  readonly runId: string;
  readonly prompt: string;
}

/**
 * Prepare run workspace directory and write prompt file.
 */
export async function prepareRunWorkspace(
  input: WorkspaceSetupInput,
): Promise<RunWorkspaceSetupResult> {
  const { root, runId, prompt } = input;

  const runWorkspace = resolveRunWorkspacePaths(root, runId);
  const runRoot = runWorkspace.absolute;

  if (await pathExists(runRoot)) {
    const displayPath = normalizePathForDisplay(relativeToRoot(root, runRoot));
    throw new RunDirectoryExistsError(runId, displayPath);
  }

  await mkdir(runRoot, { recursive: true });

  try {
    const promptPath = resolveRunPromptPath(root, runId);
    await writeFile(promptPath, prompt, { encoding: "utf8" });
  } catch (error) {
    await cleanupRunWorkspace(runRoot);
    throw error;
  }

  return { runWorkspace, prompt };
}
