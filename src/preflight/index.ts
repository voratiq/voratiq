import { isAbsolute, resolve } from "node:path";

import { ensureFileExists } from "../utils/fs.js";
import {
  assertGitRepository,
  type DirtyPathSummary,
  runGitCommand,
} from "../utils/git.js";
import { relativeToRoot } from "../utils/path.js";
import {
  collectMissingSandboxDependencies,
  formatSandboxDependencyList,
} from "../workspace/sandbox-requirements.js";
import { validateWorkspace } from "../workspace/setup.js";
import {
  resolveWorkspacePath,
  VORATIQ_RUNS_DIR,
  VORATIQ_RUNS_FILE,
} from "../workspace/structure.js";
import {
  DirtyWorkingTreeError,
  SandboxDependenciesError,
  SpecNotFoundError,
} from "./errors.js";

export interface CleanWorkingTreeResult {
  cleanWorkingTree: true;
}

export interface WorkspacePaths {
  root: string;
  workspaceDir: string;
  runsDir: string;
  runsFile: string;
}

export interface CliContext {
  root: string;
  workspacePaths: WorkspacePaths;
}

export interface ResolveCliContextOptions {
  requireWorkspace?: boolean;
}

export async function resolveCliContext(
  options: ResolveCliContextOptions = {},
): Promise<CliContext> {
  const { requireWorkspace = true } = options;
  const root = process.cwd();

  await assertGitRepository(root);

  if (requireWorkspace) {
    await validateWorkspace(root);
  }

  const workspaceDir = resolveWorkspacePath(root);
  const workspacePaths: WorkspacePaths = {
    root,
    workspaceDir,
    runsDir: resolveWorkspacePath(root, VORATIQ_RUNS_DIR),
    runsFile: resolveWorkspacePath(root, VORATIQ_RUNS_FILE),
  };

  return { root, workspacePaths };
}

export interface ResolvedSpecPath {
  absolutePath: string;
  displayPath: string;
}

export async function ensureSpecPath(
  specPath: string,
  root: string,
): Promise<ResolvedSpecPath> {
  const absolutePath = isAbsolute(specPath)
    ? specPath
    : resolve(root, specPath);
  const displayPath = relativeToRoot(root, absolutePath);

  await ensureFileExists(
    absolutePath,
    () => new SpecNotFoundError(displayPath),
  );

  return { absolutePath, displayPath };
}

export async function collectDirtyWorkingTreeSummary(
  root: string,
): Promise<DirtyPathSummary[]> {
  const output = await runGitCommand(
    ["status", "--porcelain=v1", "--untracked-files=no"],
    { cwd: root },
  );

  if (!output) {
    return [];
  }

  return parseGitStatusOutput(output);
}

export interface EnsureCleanWorkingTreeOptions {
  readonly hintLines?: readonly string[];
}

export async function ensureCleanWorkingTree(
  root: string,
  options: EnsureCleanWorkingTreeOptions = {},
): Promise<CleanWorkingTreeResult> {
  const dirtyEntries = await collectDirtyWorkingTreeSummary(root);

  if (dirtyEntries.length === 0) {
    return { cleanWorkingTree: true };
  }

  const detailLines = buildDirtyWorkingTreeDetailLines(
    dirtyEntries,
    "Dirty paths:",
  );
  const hintLines = options.hintLines ?? [
    "Stash or commit local changes before continuing.",
  ];

  throw new DirtyWorkingTreeError(detailLines, hintLines);
}

export function buildDirtyWorkingTreeDetailLines(
  entries: readonly DirtyPathSummary[],
  heading: string,
): string[] {
  const limit = 3;
  const limitedEntries = entries.slice(0, limit);

  const lines: string[] = [heading];

  if (limitedEntries.length === 0) {
    lines.push("  - (unable to determine dirty paths)");
    return lines;
  }

  for (const entry of limitedEntries) {
    lines.push(`  - ${entry.path} (${entry.annotation})`);
  }

  const remainingCount = entries.length - limitedEntries.length;
  if (remainingCount > 0) {
    const plural = remainingCount === 1 ? "path" : "paths";
    lines.push(`  - (and ${remainingCount} more ${plural})`);
  }

  return lines;
}

function parseGitStatusOutput(output: string): DirtyPathSummary[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => parseStatusLine(line));
}

export function ensureSandboxDependencies(): void {
  const missing = collectMissingSandboxDependencies();
  if (missing.length === 0) {
    return;
  }

  const missingDisplay = formatSandboxDependencyList(missing);

  throw new SandboxDependenciesError(missingDisplay);
}

function parseStatusLine(line: string): DirtyPathSummary {
  if (line.length < 3) {
    return { path: line.trim() || "<unknown>", annotation: "modified" };
  }

  const stagedCode = line[0] ?? " ";
  const worktreeCode = line[1] ?? " ";
  let pathSection = line.slice(2);
  if (pathSection.startsWith(" ")) {
    pathSection = pathSection.slice(1);
  }
  const rawPath = pathSection.trim();
  const displayPath = extractDisplayPath(rawPath);

  const annotation = describeStatus(stagedCode, worktreeCode);

  return { path: displayPath, annotation };
}

function extractDisplayPath(rawPath: string): string {
  if (!rawPath) {
    return "<unknown>";
  }
  const renameSeparator = " -> ";
  if (rawPath.includes(renameSeparator)) {
    const parts = rawPath.split(renameSeparator);
    const target = parts.at(-1);
    if (target && target.length > 0) {
      return target;
    }
  }
  return rawPath;
}

function describeStatus(stagedCode: string, worktreeCode: string): string {
  const stagedDirty = stagedCode !== " ";
  const worktreeDirty = worktreeCode !== " ";

  if (stagedDirty && worktreeDirty) {
    const worktreeDescription = describeWorktreeCode(worktreeCode);
    return `staged & ${worktreeDescription}`;
  }

  if (stagedDirty) {
    return describeStagedCode(stagedCode);
  }

  if (worktreeDirty) {
    return describeWorktreeCode(worktreeCode);
  }

  return "modified";
}

function describeStagedCode(code: string): string {
  switch (code) {
    case "A":
      return "staged add";
    case "M":
      return "staged";
    case "D":
      return "staged delete";
    case "R":
      return "staged rename";
    case "C":
      return "staged copy";
    default:
      return "staged";
  }
}

function describeWorktreeCode(code: string): string {
  switch (code) {
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "A":
      return "added";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}
