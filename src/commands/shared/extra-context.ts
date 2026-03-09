import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { isAbsolute } from "node:path";

import { CliError } from "../../cli/errors.js";
import { isFileSystemError } from "../../utils/fs.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";

export interface ResolvedExtraContextFile {
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly stagedRelativePath: string;
}

export async function resolveExtraContextFiles(options: {
  root: string;
  paths?: readonly string[];
}): Promise<ResolvedExtraContextFile[]> {
  const { root, paths } = options;
  if (!paths || paths.length === 0) {
    return [];
  }

  const resolved: ResolvedExtraContextFile[] = [];
  const allocatedBasenames = new Map<string, number>();
  for (const rawPath of paths) {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) {
      throw new CliError("`--extra-context` paths must not be empty.");
    }

    const absolutePath = isAbsolute(trimmed)
      ? trimmed
      : resolvePath(root, trimmed);

    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch (error) {
      if (
        isFileSystemError(error) &&
        ["EACCES", "EPERM"].includes(error.code)
      ) {
        throw new CliError(
          `Extra context file \`${trimmed}\` is not accessible.`,
          [`Resolved path: \`${absolutePath}\`.`],
          ["Ensure the file exists and is readable by the current user."],
        );
      }
      throw new CliError(
        `Extra context file \`${trimmed}\` not found.`,
        [],
        ["Pass a readable file path to `--extra-context`."],
      );
    }

    if (!fileStat.isFile()) {
      throw new CliError(
        `Extra context path \`${trimmed}\` is not a file.`,
        [],
        ["Pass a readable file path to `--extra-context`."],
      );
    }

    try {
      await access(absolutePath, fsConstants.R_OK);
    } catch (error) {
      if (
        isFileSystemError(error) &&
        ["EACCES", "EPERM"].includes(error.code)
      ) {
        throw new CliError(
          `Extra context file \`${trimmed}\` is not readable.`,
          [`Resolved path: \`${absolutePath}\`.`],
          ["Fix file permissions and re-run with `--extra-context`."],
        );
      }
      throw error;
    }

    const displayPath = normalizePathForDisplay(
      relativeToRoot(root, absolutePath),
    );
    const originalBasename = basename(absolutePath);
    const allocatedBasename = allocateContextBasename(
      originalBasename,
      allocatedBasenames,
    );
    resolved.push({
      absolutePath,
      displayPath,
      stagedRelativePath: join("..", "context", allocatedBasename),
    });
  }

  return resolved;
}

export async function stageExtraContextFiles(options: {
  contextPath: string;
  files: readonly ResolvedExtraContextFile[];
}): Promise<void> {
  const { contextPath, files } = options;

  for (const file of files) {
    const destination = resolveStagedDestinationPath({
      contextPath,
      stagedRelativePath: file.stagedRelativePath,
    });
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file.absolutePath, destination);
  }
}

export function appendExtraContextPromptSection(
  lines: string[],
  files: readonly ResolvedExtraContextFile[],
): void {
  if (files.length === 0) {
    return;
  }

  lines.push(
    "",
    "Extra context files (staged alongside the workspace):",
    ...files.map(
      (file) =>
        `- \`${file.stagedRelativePath}\` (source: \`${file.displayPath}\`)`,
    ),
    "- Treat these files as supplemental context for this invocation.",
  );
}

function allocateContextBasename(
  originalBasename: string,
  allocations: Map<string, number>,
): string {
  const nextCount = (allocations.get(originalBasename) ?? 0) + 1;
  allocations.set(originalBasename, nextCount);
  if (nextCount === 1) {
    return originalBasename;
  }

  const extension = extname(originalBasename);
  const stem =
    extension.length > 0
      ? originalBasename.slice(0, -extension.length)
      : originalBasename;
  return `${stem}-${nextCount}${extension}`;
}

function resolveStagedDestinationPath(options: {
  contextPath: string;
  stagedRelativePath: string;
}): string {
  const { contextPath, stagedRelativePath } = options;
  return join(contextPath, basename(stagedRelativePath));
}
