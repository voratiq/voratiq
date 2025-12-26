import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";

import { assertPathWithinRoot } from "../utils/path.js";

export interface PromoteWorkspaceFileOptions {
  /** Absolute path to the writable workspace root. */
  workspacePath: string;
  /** Absolute path to the artifacts directory for the agent. */
  artifactsPath: string;
  /** Relative path (within workspace) to the staged file. */
  stagedRelativePath: string;
  /** Relative path (within artifacts/) where the file should be promoted. */
  artifactRelativePath: string;
  /**
   * Optional transform applied to the staged file contents before writing to
   * artifacts. Receives the raw bytes read from the staged file.
   */
  transform?: (content: Buffer) => string | Buffer | Promise<string | Buffer>;
  /**
   * When the transform returns a string, this encoding is used when writing the
   * artifact (defaults to utf8).
   */
  stringEncoding?: NodeJS.BufferEncoding;
  /** Whether to delete the staged file after promotion (default: true). */
  deleteStaged?: boolean;
}

export interface PromoteWorkspaceFileResult {
  stagedPath: string;
  artifactPath: string;
}

/**
 * Promote a staged file written inside the sandboxed workspace into the
 * trusted artifacts directory. This helper enforces path containment for both
 * the source and destination and optionally transforms content before writing.
 */
export async function promoteWorkspaceFile(
  options: PromoteWorkspaceFileOptions,
): Promise<PromoteWorkspaceFileResult> {
  const workspacePath = options.workspacePath;
  const artifactsPath = options.artifactsPath;
  const stagedRelativePath = options.stagedRelativePath;
  const artifactRelativePath = options.artifactRelativePath;
  const transform = options.transform;
  const stringEncoding: NodeJS.BufferEncoding =
    options.stringEncoding ?? "utf8";
  const deleteStaged = options.deleteStaged !== false;

  const stagedPath = assertPathWithinRoot(
    workspacePath,
    resolvePath(workspacePath, stagedRelativePath),
    {
      message: `Staged path "${stagedRelativePath}" must stay inside workspace "${workspacePath}".`,
    },
  );

  const artifactPath = assertPathWithinRoot(
    artifactsPath,
    resolvePath(artifactsPath, artifactRelativePath),
    {
      message: `Artifact path "${artifactRelativePath}" must stay inside artifacts directory "${artifactsPath}".`,
    },
  );

  const raw = await readFile(stagedPath);
  const transformed = transform ? await transform(raw) : raw;
  const payload =
    typeof transformed === "string"
      ? Buffer.from(transformed, stringEncoding)
      : transformed;

  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, payload);

  if (deleteStaged) {
    await rm(stagedPath, { force: true }).catch(() => {});
  }

  return { stagedPath, artifactPath };
}
