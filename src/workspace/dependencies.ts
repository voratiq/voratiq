import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, relative, resolve as resolveAbsolute } from "node:path";

import type { SandboxStageId } from "../agents/runtime/policy.js";
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
  stageId?: SandboxStageId;
}

export type CleanupWorkspaceDependenciesOptions =
  EnsureWorkspaceDependenciesOptions;

export interface WorkspaceDependencyCleanupResult {
  nodeRemoved: boolean;
  pythonRemoved: boolean;
}

export interface WorkspaceDependencyStrategy {
  node: NodeDependencyMode;
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

interface DependencyCopyOptions {
  context: EnvironmentPathContext;
  repoRoot: string;
  workspaceRoot: string;
  sourceRoot: string;
  destinationRoot: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export type NodeDependencyMode = "copy" | "symlink";

const REPO_BOUNDARY_DESCRIPTION = "the repository root";
const WORKSPACE_BOUNDARY_DESCRIPTION = "the workspace directory";
const NEXT_CONFIG_FILENAME_PATTERN = /^next\.config\.(?:c|m)?(?:j|t)s$/u;
const nextRepositoryDetectionCache = new Map<string, Promise<boolean>>();

function formatEnvironmentPathRuntimeError(
  context: EnvironmentPathContext,
  detail: string,
): string {
  return `Invalid \`${context.key}\` path \`${context.value}\`: ${detail}.`;
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
        `resolved path \`${resolvedPath}\` escapes ${boundaryDescription} (\`${root}\`).`,
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
  const { workspacePath, environment } = options;
  const strategy = await resolveWorkspaceDependencyStrategy(options);

  await ensureNodeDependencies(
    options.root,
    workspacePath,
    environment,
    strategy.node,
  );
  await ensurePythonEnvironment(options.root, workspacePath, environment);
}

export async function cleanupWorkspaceDependencies(
  options: CleanupWorkspaceDependenciesOptions,
): Promise<WorkspaceDependencyCleanupResult> {
  const { root, workspacePath, environment } = options;
  const strategy = await resolveWorkspaceDependencyStrategy(options);

  const cleanupResult: WorkspaceDependencyCleanupResult = {
    nodeRemoved: false,
    pythonRemoved: false,
  };

  try {
    cleanupResult.nodeRemoved = await cleanupNodeDependencies(
      root,
      workspacePath,
      environment,
      strategy.node,
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
  nodeDependencyMode: NodeDependencyMode,
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
          `expected directory at \`${repoDependencyPath}\` but it does not exist.`,
        ),
      );
    }

    const workspaceDependencyPath = guardResolvedPath(
      context,
      workspacePath,
      resolvePath(workspacePath, relativeRoot),
      WORKSPACE_BOUNDARY_DESCRIPTION,
    );

    if (nodeDependencyMode === "copy") {
      await ensureDirectoryCopy(repoDependencyPath, workspaceDependencyPath, {
        context,
        targetRoot: root,
        linkRoot: workspacePath,
      });
    } else {
      await ensureDirectoryLink(repoDependencyPath, workspaceDependencyPath, {
        context,
        targetRoot: root,
        linkRoot: workspacePath,
      });
    }
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
        `expected directory at \`${repoPythonPath}\` but it does not exist.`,
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
  nodeDependencyMode: NodeDependencyMode,
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
    const removed = await removeWorkspaceNodeDependency(
      workspaceDependencyPath,
      repoDependencyPath,
      nodeDependencyMode,
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

async function ensureDirectoryCopy(
  sourcePath: string,
  destinationPath: string,
  options: DirectoryLinkOptions,
): Promise<void> {
  const safeSourcePath = guardResolvedPath(
    options.context,
    options.targetRoot,
    sourcePath,
    REPO_BOUNDARY_DESCRIPTION,
  );
  const safeDestinationPath = guardResolvedPath(
    options.context,
    options.linkRoot,
    destinationPath,
    WORKSPACE_BOUNDARY_DESCRIPTION,
  );

  const copyOptions: DependencyCopyOptions = {
    context: options.context,
    repoRoot: options.targetRoot,
    workspaceRoot: options.linkRoot,
    sourceRoot: safeSourcePath,
    destinationRoot: safeDestinationPath,
  };

  await rm(safeDestinationPath, { recursive: true, force: true });
  await mkdir(dirname(safeDestinationPath), { recursive: true });
  await copyDependencyEntry(
    copyOptions,
    safeSourcePath,
    safeDestinationPath,
    new Set<string>(),
  );
}

async function removeWorkspaceNodeDependency(
  linkPath: string,
  expectedTarget: string,
  nodeDependencyMode: NodeDependencyMode,
): Promise<boolean> {
  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      if (nodeDependencyMode !== "copy") {
        return false;
      }
      await rm(linkPath, { recursive: true, force: true });
      return true;
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

async function copyDependencyEntry(
  options: DependencyCopyOptions,
  sourcePath: string,
  destinationPath: string,
  activePaths: Set<string>,
): Promise<void> {
  const safeSourcePath = guardResolvedPath(
    options.context,
    options.repoRoot,
    sourcePath,
    REPO_BOUNDARY_DESCRIPTION,
  );
  const safeDestinationPath = guardResolvedPath(
    options.context,
    options.workspaceRoot,
    destinationPath,
    WORKSPACE_BOUNDARY_DESCRIPTION,
  );

  if (activePaths.has(safeSourcePath)) {
    throw new WorkspaceSetupError(
      formatEnvironmentPathRuntimeError(
        options.context,
        `dependency tree contains a recursive symlink at \`${safeSourcePath}\``,
      ),
    );
  }

  const stats = await lstat(safeSourcePath);
  if (stats.isSymbolicLink()) {
    await copyDependencySymlink(
      options,
      safeSourcePath,
      safeDestinationPath,
      activePaths,
    );
    return;
  }

  if (stats.isFile()) {
    await mkdir(dirname(safeDestinationPath), { recursive: true });
    await copyFile(safeSourcePath, safeDestinationPath);
    await chmod(safeDestinationPath, stats.mode);
    return;
  }

  if (!stats.isDirectory()) {
    throw new WorkspaceSetupError(
      formatEnvironmentPathRuntimeError(
        options.context,
        `dependency tree contains unsupported file type at \`${safeSourcePath}\``,
      ),
    );
  }

  activePaths.add(safeSourcePath);
  try {
    await mkdir(safeDestinationPath, { recursive: true });
    for (const child of await readdir(safeSourcePath)) {
      await copyDependencyEntry(
        options,
        resolveAbsolute(safeSourcePath, child),
        resolveAbsolute(safeDestinationPath, child),
        activePaths,
      );
    }
    await chmod(safeDestinationPath, stats.mode);
  } finally {
    activePaths.delete(safeSourcePath);
  }
}

async function copyDependencySymlink(
  options: DependencyCopyOptions,
  sourcePath: string,
  destinationPath: string,
  activePaths: Set<string>,
): Promise<void> {
  const linkTarget = await readlink(sourcePath);
  const resolvedTarget = guardResolvedPath(
    options.context,
    options.repoRoot,
    resolveAbsolute(dirname(sourcePath), linkTarget),
    REPO_BOUNDARY_DESCRIPTION,
  );
  const dependencyRootTarget = tryPathWithinRoot(
    options.sourceRoot,
    resolvedTarget,
  );

  if (dependencyRootTarget) {
    const copiedTargetPath = mapDependencySourcePathToDestination(
      options,
      dependencyRootTarget,
    );
    const rebasedTarget =
      relative(dirname(destinationPath), copiedTargetPath) || ".";
    const targetType = await inferSymlinkType(dependencyRootTarget);
    await mkdir(dirname(destinationPath), { recursive: true });
    await symlink(rebasedTarget, destinationPath, targetType);
    return;
  }

  activePaths.add(sourcePath);
  try {
    await copyDependencyEntry(
      options,
      resolvedTarget,
      destinationPath,
      activePaths,
    );
  } finally {
    activePaths.delete(sourcePath);
  }
}

function tryPathWithinRoot(root: string, targetPath: string): string | null {
  try {
    return assertPathWithinRoot(root, targetPath);
  } catch {
    return null;
  }
}

function mapDependencySourcePathToDestination(
  options: DependencyCopyOptions,
  sourcePath: string,
): string {
  const relativePath = relative(options.sourceRoot, sourcePath);
  return relativePath
    ? resolveAbsolute(options.destinationRoot, relativePath)
    : options.destinationRoot;
}

async function inferSymlinkType(targetPath: string): Promise<"dir" | "file"> {
  try {
    const stats = await lstat(targetPath);
    return stats.isDirectory() ? "dir" : "file";
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return "file";
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

async function resolveNodeDependencyMode(options: {
  root: string;
  environment: EnvironmentConfig;
  stageId?: SandboxStageId;
}): Promise<NodeDependencyMode> {
  const { root, environment, stageId } = options;
  if (stageId !== "run" || getNodeDependencyRoots(environment).length === 0) {
    return "symlink";
  }
  return (await repositoryUsesNextJs(root)) ? "copy" : "symlink";
}

export async function resolveWorkspaceDependencyStrategy(options: {
  root: string;
  environment: EnvironmentConfig;
  stageId?: SandboxStageId;
}): Promise<WorkspaceDependencyStrategy> {
  return {
    node: await resolveNodeDependencyMode(options),
  };
}

async function repositoryUsesNextJs(root: string): Promise<boolean> {
  const cached = nextRepositoryDetectionCache.get(root);
  if (cached) {
    return await cached;
  }

  const detection = detectNextRepository(root);
  nextRepositoryDetectionCache.set(root, detection);
  return await detection;
}

async function detectNextRepository(root: string): Promise<boolean> {
  const packageJsonPath = resolvePath(root, "package.json");
  if (await packageJsonUsesDependency(packageJsonPath, "next")) {
    return true;
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && NEXT_CONFIG_FILENAME_PATTERN.test(entry.name)) {
      return true;
    }
  }

  return false;
}

async function packageJsonUsesDependency(
  packageJsonPath: string,
  dependencyName: string,
): Promise<boolean> {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(raw) as PackageJson;
    return hasPackageDependency(packageJson, dependencyName);
  } catch {
    return false;
  }
}

function hasPackageDependency(
  packageJson: PackageJson,
  dependencyName: string,
): boolean {
  return Boolean(
    packageJson.dependencies?.[dependencyName] ??
    packageJson.devDependencies?.[dependencyName] ??
    packageJson.optionalDependencies?.[dependencyName] ??
    packageJson.peerDependencies?.[dependencyName],
  );
}
