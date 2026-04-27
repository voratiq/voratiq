import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";

import { RunDirectoryExistsError } from "../domain/run/competition/errors.js";
import { pathExists } from "../utils/fs.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../utils/path.js";
import { VORATIQ_SPEC_DIR } from "./constants.js";
import type { RunWorkspacePaths } from "./layout.js";
import { resolveRunWorkspacePaths } from "./layout.js";
import { formatDomainScopedPath } from "./path-formatters.js";

export interface StageExternalSpecCopyInput {
  readonly root: string;
  readonly sourceAbsolutePath: string;
}

export interface StagedExternalSpecCopy {
  readonly absolutePath: string;
  readonly relativePath: string;
}

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

export async function stageExternalSpecCopy(
  input: StageExternalSpecCopyInput,
): Promise<StagedExternalSpecCopy> {
  const { root, sourceAbsolutePath } = input;
  const originalBasename = basename(sourceAbsolutePath);
  const allocatedBasename = await allocateExternalSpecBasename(
    root,
    originalBasename,
  );
  const relativePath = formatDomainScopedPath(
    VORATIQ_SPEC_DIR,
    allocatedBasename,
  );
  const absolutePath = resolvePath(root, relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await copyFile(sourceAbsolutePath, absolutePath);

  return { absolutePath, relativePath };
}

async function allocateExternalSpecBasename(
  root: string,
  originalBasename: string,
): Promise<string> {
  const extension = extname(originalBasename);
  const stem =
    extension.length > 0
      ? originalBasename.slice(0, -extension.length)
      : originalBasename;

  let candidate = originalBasename;
  let nextCount = 2;
  while (
    await pathExists(
      resolvePath(root, formatDomainScopedPath(VORATIQ_SPEC_DIR, candidate)),
    )
  ) {
    candidate = `${stem}-${nextCount}${extension}`;
    nextCount += 1;
  }

  return candidate;
}
