import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, resolve as resolveAbsolute } from "node:path";

import {
  type EnvironmentConfig,
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
} from "../configs/environment/types.js";
import { toErrorMessage } from "../utils/errors.js";
import { isFileSystemError, pathExists } from "../utils/fs.js";
import {
  assertPathWithinRoot,
  assertRepoRelativePath,
  resolvePath,
} from "../utils/path.js";
import { WorkspaceSetupError } from "./errors.js";

export interface EnsureWorkspaceDependenciesOptions {
  root: string;
  workspacePath: string;
  environment: EnvironmentConfig;
}

export type CleanupWorkspaceDependenciesOptions =
  EnsureWorkspaceDependenciesOptions;

export interface WorkspaceDependencyCleanupResult {
  nodeRemoved: boolean;
  pythonRemoved: boolean;
}

interface WorkspaceDependencyCleanupErrorOptions {
  cleanup: WorkspaceDependencyCleanupResult;
  cause?: unknown;
}

export class WorkspaceDependencyCleanupError extends Error {
  public readonly cleanup: WorkspaceDependencyCleanupResult;
  public readonly cause: unknown;

  constructor(options: WorkspaceDependencyCleanupErrorOptions) {
    const { cleanup, cause } = options;
    const detail = cause
      ? `Failed to clean workspace dependencies: ${toErrorMessage(cause)}`
      : "Failed to clean workspace dependencies.";
    super(detail);
    this.cleanup = cleanup;
    this.cause = cause;
    this.name = "WorkspaceDependencyCleanupError";
  }
}

interface EnvironmentPathContext {
  key: string;
  value: string;
}

interface DirectoryLinkOptions {
  context: EnvironmentPathContext;
  targetRoot: string;
  linkRoot: string;
}

const REPO_BOUNDARY_DESCRIPTION = "the repository root";
const WORKSPACE_BOUNDARY_DESCRIPTION = "the workspace directory";

function formatEnvironmentPathRuntimeError(
  context: EnvironmentPathContext,
  detail: string,
): string {
  return `Invalid ${context.key} "${context.value}": ${detail}.`;
}

function assertRepoRelativeEnvironmentPath(
  context: EnvironmentPathContext,
): void {
  const value = context.value;
  if (value.length === 0) {
    throw new WorkspaceSetupError(
      formatEnvironmentPathRuntimeError(context, "value must be non-empty."),
    );
  }
  try {
    assertRepoRelativePath(value);
  } catch (error) {
    throw new WorkspaceSetupError(
      formatEnvironmentPathRuntimeError(
        context,
        error instanceof Error
          ? error.message
          : "paths must remain inside the repository (no absolute entries, '..', or backslashes).",
      ),
    );
  }
}

function guardResolvedPath(
  context: EnvironmentPathContext,
  root: string,
  resolvedPath: string,
  boundaryDescription: string,
): string {
  try {
    return assertPathWithinRoot(root, resolvedPath);
  } catch {
    throw new WorkspaceSetupError(
      formatEnvironmentPathRuntimeError(
        context,
        `resolved path "${resolvedPath}" escapes ${boundaryDescription} (${root}).`,
      ),
    );
  }
}

function createNodeContext(
  index: number,
  value: string,
): EnvironmentPathContext {
  return { key: `node.dependencyRoots[${index}]`, value };
}

function createPythonContext(value: string): EnvironmentPathContext {
  return { key: "python.path", value };
}

export async function ensureWorkspaceDependencies(
  options: EnsureWorkspaceDependenciesOptions,
): Promise<void> {
  const { root, workspacePath, environment } = options;

  await ensureNodeDependencies(root, workspacePath, environment);
  await ensurePythonEnvironment(root, workspacePath, environment);
}

export async function cleanupWorkspaceDependencies(
  options: CleanupWorkspaceDependenciesOptions,
): Promise<WorkspaceDependencyCleanupResult> {
  const { root, workspacePath, environment } = options;

  const cleanupResult: WorkspaceDependencyCleanupResult = {
    nodeRemoved: false,
    pythonRemoved: false,
  };

  try {
    cleanupResult.nodeRemoved = await cleanupNodeDependencies(
      root,
      workspacePath,
      environment,
    );
    cleanupResult.pythonRemoved = await cleanupPythonEnvironment(
      root,
      workspacePath,
      environment,
    );
    return cleanupResult;
  } catch (error) {
    if (cleanupResult.nodeRemoved || cleanupResult.pythonRemoved) {
      throw new WorkspaceDependencyCleanupError({
        cleanup: cleanupResult,
        cause: error,
      });
    }
    throw error;
  }
}

async function ensureNodeDependencies(
  root: string,
  workspacePath: string,
  environment: EnvironmentConfig,
): Promise<void> {
  const dependencyRoots = getNodeDependencyRoots(environment);
  for (const [index, relativeRoot] of dependencyRoots.entries()) {
    const context = createNodeContext(index, relativeRoot);
    assertRepoRelativeEnvironmentPath(context);

    const repoDependencyPath = guardResolvedPath(
      context,
      root,
      resolvePath(root, relativeRoot),
      REPO_BOUNDARY_DESCRIPTION,
    );
    if (!(await pathExists(repoDependencyPath))) {
      throw new WorkspaceSetupError(
        formatEnvironmentPathRuntimeError(
          context,
          `expected directory at "${repoDependencyPath}" but it does not exist.`,
        ),
      );
    }

    const workspaceDependencyPath = guardResolvedPath(
      context,
      workspacePath,
      resolvePath(workspacePath, relativeRoot),
      WORKSPACE_BOUNDARY_DESCRIPTION,
    );

    await ensureDirectoryLink(repoDependencyPath, workspaceDependencyPath, {
      context,
      targetRoot: root,
      linkRoot: workspacePath,
    });
  }
}

async function ensurePythonEnvironment(
  root: string,
  workspacePath: string,
  environment: EnvironmentConfig,
): Promise<void> {
  const pythonPath = getPythonEnvironmentPath(environment);
  if (!pythonPath) {
    return;
  }

  const context = createPythonContext(pythonPath);
  assertRepoRelativeEnvironmentPath(context);

  const repoPythonPath = guardResolvedPath(
    context,
    root,
    resolvePath(root, pythonPath),
    REPO_BOUNDARY_DESCRIPTION,
  );
  if (!(await pathExists(repoPythonPath))) {
    throw new WorkspaceSetupError(
      formatEnvironmentPathRuntimeError(
        context,
        `expected directory at "${repoPythonPath}" but it does not exist.`,
      ),
    );
  }

  const workspacePythonPath = guardResolvedPath(
    context,
    workspacePath,
    resolvePath(workspacePath, ".venv"),
    WORKSPACE_BOUNDARY_DESCRIPTION,
  );
  await ensureDirectoryLink(repoPythonPath, workspacePythonPath, {
    context,
    targetRoot: root,
    linkRoot: workspacePath,
  });
}

async function cleanupNodeDependencies(
  root: string,
  workspacePath: string,
  environment: EnvironmentConfig,
): Promise<boolean> {
  let removedAny = false;
  const dependencyRoots = getNodeDependencyRoots(environment);
  for (const [index, relativeRoot] of dependencyRoots.entries()) {
    const context = createNodeContext(index, relativeRoot);
    assertRepoRelativeEnvironmentPath(context);

    const workspaceDependencyPath = guardResolvedPath(
      context,
      workspacePath,
      resolvePath(workspacePath, relativeRoot),
      WORKSPACE_BOUNDARY_DESCRIPTION,
    );
    const repoDependencyPath = guardResolvedPath(
      context,
      root,
      resolvePath(root, relativeRoot),
      REPO_BOUNDARY_DESCRIPTION,
    );
    const removed = await removeWorkspaceLink(
      workspaceDependencyPath,
      repoDependencyPath,
    );
    removedAny ||= removed;
  }
  return removedAny;
}

async function cleanupPythonEnvironment(
  root: string,
  workspacePath: string,
  environment: EnvironmentConfig,
): Promise<boolean> {
  const pythonPath = getPythonEnvironmentPath(environment);
  if (!pythonPath) {
    return false;
  }

  const context = createPythonContext(pythonPath);
  assertRepoRelativeEnvironmentPath(context);

  const workspacePythonPath = guardResolvedPath(
    context,
    workspacePath,
    resolvePath(workspacePath, ".venv"),
    WORKSPACE_BOUNDARY_DESCRIPTION,
  );
  const repoPythonPath = guardResolvedPath(
    context,
    root,
    resolvePath(root, pythonPath),
    REPO_BOUNDARY_DESCRIPTION,
  );
  return removeWorkspaceLink(workspacePythonPath, repoPythonPath);
}

async function ensureDirectoryLink(
  targetPath: string,
  linkPath: string,
  options: DirectoryLinkOptions,
): Promise<void> {
  const safeTargetPath = guardResolvedPath(
    options.context,
    options.targetRoot,
    targetPath,
    REPO_BOUNDARY_DESCRIPTION,
  );
  const safeLinkPath = guardResolvedPath(
    options.context,
    options.linkRoot,
    linkPath,
    WORKSPACE_BOUNDARY_DESCRIPTION,
  );

  const createLink = async (): Promise<void> => {
    await mkdir(dirname(safeLinkPath), { recursive: true });
    await symlink(safeTargetPath, safeLinkPath, "dir");
  };

  try {
    const stats = await lstat(safeLinkPath);
    if (stats.isSymbolicLink()) {
      const linkTarget = await readlink(safeLinkPath);
      const resolvedTarget = resolveAbsolute(dirname(safeLinkPath), linkTarget);
      if (resolvedTarget === safeTargetPath) {
        return;
      }
      await rm(safeLinkPath, { recursive: true, force: true });
      await createLink();
      return;
    }

    await rm(safeLinkPath, { recursive: true, force: true });
    await createLink();
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      await createLink();
      return;
    }

    throw error;
  }
}

async function removeWorkspaceLink(
  linkPath: string,
  expectedTarget: string,
): Promise<boolean> {
  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      return false;
    }
    const linkTarget = await readlink(linkPath);
    const resolvedTarget = resolveAbsolute(dirname(linkPath), linkTarget);
    if (resolvedTarget !== expectedTarget) {
      return false;
    }
    await rm(linkPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
