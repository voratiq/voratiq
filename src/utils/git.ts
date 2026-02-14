import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { GitHeadRequiredError, GitRepositoryError } from "./errors.js";

const execFileAsync = promisify(execFile);
const { F_OK } = fsConstants;

export const GIT_AUTHOR_NAME = "voratiq-runs";
export const GIT_AUTHOR_EMAIL = "runs@voratiq.com";
export const GIT_COMMITTER_NAME = GIT_AUTHOR_NAME;
export const GIT_COMMITTER_EMAIL = GIT_AUTHOR_EMAIL;

export interface GitCommandOptions {
  cwd: string;
  trim?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface DirtyPathSummary {
  path: string;
  annotation: string;
}

export async function assertGitRepository(root: string): Promise<void> {
  const gitPath = join(root, ".git");
  try {
    await access(gitPath, F_OK);
  } catch {
    // Check if we're inside a git repo but not at its root
    const repoRoot = await getGitRepositoryRoot(root);
    if (repoRoot !== null) {
      // We're in a repo but not at the root
      throw new GitRepositoryError(
        "Run `voratiq init` from the repository root.",
      );
    }
    // No git repository exists at all
    throw new GitRepositoryError(
      "No git repository found. Run `git init` or switch to an existing repository.",
    );
  }
}

/**
 * Attempts to find the root of a git repository by running `git rev-parse --show-toplevel`.
 * Returns the repository root path if inside a git repo, or null if not.
 */
async function getGitRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd,
        encoding: "utf8",
      },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function runGitCommand(
  args: string[],
  options: GitCommandOptions,
): Promise<string> {
  const { cwd, trim = true, env } = options;
  const execEnv = env ? { ...process.env, ...env } : undefined;
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: execEnv,
  });

  return trim ? stdout.trim() : stdout;
}

export async function getHeadRevision(cwd: string): Promise<string> {
  try {
    return await runGitCommand(["rev-parse", "HEAD"], { cwd });
  } catch (error) {
    if (isHeadMissing(error)) {
      throw new GitHeadRequiredError();
    }
    throw error;
  }
}

export interface CreateWorktreeOptions {
  root: string;
  worktreePath: string;
  branch: string;
  baseRevision: string;
}

export async function createWorktree(
  options: CreateWorktreeOptions,
): Promise<void> {
  const { root, worktreePath, branch, baseRevision } = options;
  await runGitCommand(
    ["worktree", "add", "-b", branch, worktreePath, baseRevision],
    { cwd: root },
  );
}

export async function gitAddAll(cwd: string): Promise<void> {
  await runGitCommand(["add", "-A"], { cwd });
}

export async function gitHasStagedChanges(cwd: string): Promise<boolean> {
  const output = await runGitCommand(["diff", "--cached", "--name-only"], {
    cwd,
    trim: true,
  });
  return output.length > 0;
}

export interface GitCommitOptions {
  cwd: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
  bypassHooks?: boolean;
}

export async function gitCommitAll(options: GitCommitOptions): Promise<void> {
  const {
    cwd,
    message,
    authorName = GIT_AUTHOR_NAME,
    authorEmail = GIT_AUTHOR_EMAIL,
    bypassHooks = false,
  } = options;

  const args = ["commit", "-m", message];
  if (bypassHooks) {
    args.push("--no-verify");
  }

  const env: NodeJS.ProcessEnv = {
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
  };

  if (bypassHooks) {
    env.HUSKY = "0";
    env.HUSKY_SKIP_HOOKS = "1";
    env.LEFTHOOK = "0";
  }

  await runGitCommand(args, {
    cwd,
    env,
  });
}

export interface GitDiffStatOptions {
  cwd: string;
  baseRevision: string;
  targetRevision: string;
}

export async function gitDiffShortStat(
  options: GitDiffStatOptions,
): Promise<string | undefined> {
  const { cwd, baseRevision, targetRevision } = options;
  const output = await runGitCommand(
    ["diff", "--shortstat", baseRevision, targetRevision],
    { cwd },
  );

  return output.length === 0 ? undefined : output;
}

export async function gitDiff(options: GitDiffStatOptions): Promise<string> {
  const { cwd, baseRevision, targetRevision } = options;
  return runGitCommand(
    ["diff", "--binary", "--no-color", baseRevision, targetRevision],
    {
      cwd,
      trim: false,
    },
  );
}

export function getGitStderr(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  ) {
    const stderr = (error as { stderr: string }).stderr.trim();
    if (stderr.length > 0) {
      return stderr;
    }
  }

  return undefined;
}

function isHeadMissing(error: unknown): boolean {
  const stderr = getGitStderr(error);
  const normalized = stderr?.toLowerCase() ?? "";
  const code = (error as { code?: unknown }).code;

  const headMissingMessage =
    normalized.includes("ambiguous argument 'head'") ||
    normalized.includes("unknown revision or path not in the working tree") ||
    normalized.includes("needed a single revision");

  const isHeadExitCode = code === 128 || code === "128";

  return headMissingMessage || (isHeadExitCode && normalized.includes("head"));
}
