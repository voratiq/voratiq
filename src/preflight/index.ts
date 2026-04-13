import { isAbsolute, resolve } from "node:path";

import { executeDoctorReconcile } from "../commands/doctor/reconcile.js";
import { ensureFileExists, pathExists } from "../utils/fs.js";
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
import {
  repairWorkspaceStructure,
  validateWorkspace,
} from "../workspace/setup.js";
import {
  resolveWorkspacePath,
  VORATIQ_INTERACTIVE_DIR,
  VORATIQ_INTERACTIVE_FILE,
  VORATIQ_MESSAGE_DIR,
  VORATIQ_MESSAGE_FILE,
  VORATIQ_REDUCTION_DIR,
  VORATIQ_REDUCTION_FILE,
  VORATIQ_RUN_DIR,
  VORATIQ_RUN_FILE,
  VORATIQ_SPEC_DIR,
  VORATIQ_SPEC_FILE,
  VORATIQ_VERIFICATION_DIR,
  VORATIQ_VERIFICATION_FILE,
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
  reductionsDir?: string;
  reductionsFile?: string;
  messagesDir?: string;
  messagesFile?: string;
  interactiveDir?: string;
  interactiveFile?: string;
  specsDir: string;
  specsFile: string;
  verificationsDir?: string;
  verificationsFile?: string;
}

export interface CliContext {
  root: string;
  workspacePaths: WorkspacePaths;
  workspaceAutoInitialized?: boolean;
  workspaceAutoRepaired?: boolean;
}

export type WorkspaceAutoInitMode = "never" | "when-missing";

export interface ResolveCliContextOptions {
  requireWorkspace?: boolean;
  workspaceAutoInitMode?: WorkspaceAutoInitMode;
  restoreShippedVerificationTemplates?: boolean;
}

export async function resolveCliContext(
  options: ResolveCliContextOptions = {},
): Promise<CliContext> {
  const {
    requireWorkspace = true,
    workspaceAutoInitMode = "never",
    restoreShippedVerificationTemplates = true,
  } = options;
  const root = process.cwd();

  await assertGitRepository(root);

  const workspaceDir = resolveWorkspacePath(root);
  const initialWorkspaceExists = await pathExists(workspaceDir);
  let workspaceAutoInitialized = false;
  let workspaceAutoRepaired = false;

  if (requireWorkspace) {
    let workspaceMissing = !initialWorkspaceExists;
    if (workspaceAutoInitMode === "when-missing" && workspaceMissing) {
      await executeDoctorReconcile({ root });
      workspaceAutoInitialized = true;
      workspaceMissing = false;
    }

    if (!workspaceMissing) {
      const repairResult = await repairWorkspaceStructure(root, {
        restoreShippedVerificationTemplates,
      });
      workspaceAutoRepaired = repairResult.repaired;
    }

    await validateWorkspace(root);
  }

  const workspacePaths: WorkspacePaths = {
    root,
    workspaceDir,
    runsDir: resolveWorkspacePath(root, VORATIQ_RUN_DIR),
    runsFile: resolveWorkspacePath(root, VORATIQ_RUN_FILE),
    reductionsDir: resolveWorkspacePath(root, VORATIQ_REDUCTION_DIR),
    reductionsFile: resolveWorkspacePath(root, VORATIQ_REDUCTION_FILE),
    messagesDir: resolveWorkspacePath(root, VORATIQ_MESSAGE_DIR),
    messagesFile: resolveWorkspacePath(root, VORATIQ_MESSAGE_FILE),
    interactiveDir: resolveWorkspacePath(root, VORATIQ_INTERACTIVE_DIR),
    interactiveFile: resolveWorkspacePath(root, VORATIQ_INTERACTIVE_FILE),
    specsDir: resolveWorkspacePath(root, VORATIQ_SPEC_DIR),
    specsFile: resolveWorkspacePath(root, VORATIQ_SPEC_FILE),
    verificationsDir: resolveWorkspacePath(root, VORATIQ_VERIFICATION_DIR),
    verificationsFile: resolveWorkspacePath(root, VORATIQ_VERIFICATION_FILE),
  };

  return {
    root,
    workspacePaths,
    workspaceAutoInitialized,
    workspaceAutoRepaired,
  };
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
