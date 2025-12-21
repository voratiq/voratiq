import * as fs from "node:fs/promises";

import { NonInteractiveShellError } from "../../cli/errors.js";
import {
  RunRecordNotFoundError,
  RunRecordParseError,
} from "../../records/errors.js";
import {
  rewriteRunRecord,
  RUN_RECORD_FILENAME,
} from "../../records/persistence.js";
import type { RunRecord } from "../../records/types.js";
import { buildPruneConfirmationPreface } from "../../render/transcripts/prune.js";
import { toErrorMessage } from "../../utils/errors.js";
import { pathExists } from "../../utils/fs.js";
import { getGitStderr, runGitCommand } from "../../utils/git.js";
import {
  normalizePathForDisplay,
  resolveDisplayPath,
  resolvePath,
} from "../../utils/path.js";
import {
  deriveAgentBranches,
  removeRunDirectory,
  removeWorkspaceEntry,
} from "../../workspace/prune.js";
import {
  buildAgentArtifactPaths,
  formatWorkspacePath,
  getAgentDirectoryPath,
  getAgentEvalsDirectoryPath,
  getAgentWorkspaceDirectoryPath,
  resolveWorkspacePath,
  VORATIQ_RUNS_DIR,
} from "../../workspace/structure.js";
import { fetchRunSafely } from "../fetch.js";
import {
  PruneBranchDeletionError,
  PruneRunDeletedError,
  RunMetadataMissingError,
} from "./errors.js";
import type {
  PruneArtifactSummary,
  PruneCommandInput,
  PruneResult,
  PruneWorkspaceSummary,
} from "./types.js";

export async function executePruneCommand(
  input: PruneCommandInput,
): Promise<PruneResult> {
  const {
    root,
    runsFilePath,
    runId,
    confirm,
    clock,
    purge: purgeInput,
  } = input;
  const purge = purgeInput ?? false;

  if (!confirm) {
    throw new NonInteractiveShellError();
  }

  const runRecord = await fetchRunSafely({
    root,
    runsFilePath,
    runId,
    onDeleted: (record) => new PruneRunDeletedError(record.runId),
  });

  const runPathDisplay = formatWorkspacePath(VORATIQ_RUNS_DIR, runRecord.runId);
  const branches = deriveAgentBranches(runRecord);
  const workspaceTargets = buildWorkspaceTargets({
    root,
    runRecord,
  });
  const agentDirectories = buildAgentDirectoryDisplayPaths({
    runRecord,
  });
  const artifactTargets = purge
    ? buildArtifactTargets({ root, runRecord })
    : [];

  const confirmationAccepted = await confirm({
    message: "Proceed?",
    defaultValue: false,
    prefaceLines: buildPruneConfirmationPreface({
      runId: runRecord.runId,
      specPath: runRecord.spec.path,
      workspaces: workspaceTargets.map((target) => target.displayPath),
      directories: agentDirectories,
      branches,
      purge,
      previouslyDeletedAt: runRecord.deletedAt ?? undefined,
      runStatus: runRecord.status,
      createdAt: runRecord.createdAt,
      runPath: runPathDisplay,
    }),
  });

  if (!confirmationAccepted) {
    return {
      status: "aborted",
      runId: runRecord.runId,
      specPath: runRecord.spec.path,
      runPath: runPathDisplay,
    };
  }

  let workspaceSummary: PruneWorkspaceSummary;
  let artifactSummary: PruneArtifactSummary;

  if (purge) {
    workspaceSummary = await summarizeWorkspaceTargets(workspaceTargets);
    artifactSummary = await summarizeArtifactTargets(artifactTargets);
    await purgeRunDirectoryExceptRecord({
      root,
      runRecord,
    });
  } else {
    workspaceSummary = await pruneWorkspaces({
      root,
      targets: workspaceTargets,
    });

    artifactSummary = await pruneArtifacts({
      root,
      purge,
      targets: artifactTargets,
    });
  }

  const branchSummary = await pruneBranches({
    root,
    branches,
  });

  const deletedAt = (clock?.() ?? new Date()).toISOString();

  const updatedRecord = await rewriteHistory({
    root,
    runsFilePath,
    runId: runRecord.runId,
    deletedAt,
  });

  return {
    status: "pruned",
    runId: updatedRecord.runId,
    specPath: updatedRecord.spec.path,
    runPath: runPathDisplay,
    createdAt: updatedRecord.createdAt,
    deletedAt: updatedRecord.deletedAt ?? deletedAt,
    workspaces: workspaceSummary,
    artifacts: artifactSummary,
    branches: branchSummary,
  };
}

interface WorkspaceTarget {
  displayPath: string;
  absolutePath: string | null;
}

interface ArtifactTarget {
  displayPath: string;
  absolutePath: string | null;
  type: "file" | "directory";
}

function buildAgentDirectoryDisplayPaths(options: {
  runRecord: RunRecord;
}): string[] {
  const { runRecord } = options;
  const unique = new Set<string>();

  for (const agent of runRecord.agents) {
    const directoryPath = getAgentDirectoryPath(runRecord.runId, agent.agentId);
    const displayPath = normalizePathForDisplay(directoryPath);
    if (displayPath.length === 0) {
      continue;
    }
    unique.add(displayPath);
  }

  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
}

function buildWorkspaceTargets(options: {
  root: string;
  runRecord: RunRecord;
}): WorkspaceTarget[] {
  const { root, runRecord } = options;
  const unique = new Map<string, WorkspaceTarget>();

  for (const agent of runRecord.agents) {
    const workspacePath = getAgentWorkspaceDirectoryPath(
      runRecord.runId,
      agent.agentId,
    );
    const displayPath = normalizePathForDisplay(workspacePath);
    if (displayPath.length === 0) {
      continue;
    }
    if (!unique.has(displayPath)) {
      unique.set(displayPath, {
        displayPath,
        absolutePath: resolveDisplayPath(root, displayPath),
      });
    }
  }

  return Array.from(unique.values()).sort((a, b) =>
    a.displayPath.localeCompare(b.displayPath),
  );
}

function buildArtifactTargets(options: {
  root: string;
  runRecord: RunRecord;
}): ArtifactTarget[] {
  const { root, runRecord } = options;
  const entries = new Map<string, ArtifactTarget>();

  const register = (path: string | undefined, type: "file" | "directory") => {
    if (!path) {
      return;
    }
    const displayPath = normalizePathForDisplay(path);
    if (displayPath.length === 0) {
      return;
    }
    const existing = entries.get(displayPath);
    if (existing) {
      if (type === "directory" && existing.type === "file") {
        existing.type = type;
      }
      return;
    }
    entries.set(displayPath, {
      displayPath,
      absolutePath: resolveDisplayPath(root, displayPath),
      type,
    });
  };

  for (const agent of runRecord.agents) {
    const artifactPaths = buildAgentArtifactPaths({
      runId: runRecord.runId,
      agentId: agent.agentId,
      artifacts: agent.artifacts,
    });

    const artifactFlags = agent.artifacts ?? {};

    if (artifactFlags.stdoutCaptured ?? true) {
      register(artifactPaths.stdoutPath, "file");
    }
    if (artifactFlags.stderrCaptured ?? true) {
      register(artifactPaths.stderrPath, "file");
    }
    register(artifactPaths.diffPath, "file");
    register(artifactPaths.summaryPath, "file");
    register(artifactPaths.chatPath, "file");

    const hasEvalLogs = (agent.evals ?? []).some(
      (evaluation) => evaluation.hasLog,
    );
    if (hasEvalLogs) {
      register(
        getAgentEvalsDirectoryPath(runRecord.runId, agent.agentId),
        "directory",
      );
    }
  }

  return Array.from(entries.values()).sort((a, b) =>
    a.displayPath.localeCompare(b.displayPath),
  );
}

async function summarizeWorkspaceTargets(
  targets: readonly WorkspaceTarget[],
): Promise<PruneWorkspaceSummary> {
  const removed: string[] = [];
  const missing: string[] = [];

  for (const target of targets) {
    const absolutePath = target.absolutePath;
    if (!absolutePath) {
      missing.push(target.displayPath);
      continue;
    }
    if (await pathExists(absolutePath)) {
      removed.push(target.displayPath);
    } else {
      missing.push(target.displayPath);
    }
  }

  return { removed, missing };
}

async function summarizeArtifactTargets(
  targets: readonly ArtifactTarget[],
): Promise<PruneArtifactSummary> {
  const removed: string[] = [];
  const missing: string[] = [];

  for (const target of targets) {
    const absolutePath = target.absolutePath;
    if (!absolutePath) {
      missing.push(target.displayPath);
      continue;
    }
    if (await pathExists(absolutePath)) {
      removed.push(target.displayPath);
    } else {
      missing.push(target.displayPath);
    }
  }

  return { purged: true, removed, missing };
}

async function pruneWorkspaces(options: {
  root: string;
  targets: WorkspaceTarget[];
}): Promise<PruneWorkspaceSummary> {
  const { root, targets } = options;
  const removed: string[] = [];
  const missing: string[] = [];

  for (const target of targets) {
    const absolutePath = target.absolutePath;
    if (!absolutePath) {
      missing.push(target.displayPath);
      continue;
    }
    if (!(await pathExists(absolutePath))) {
      missing.push(target.displayPath);
      continue;
    }

    await removeRunDirectory(absolutePath, root);
    removed.push(target.displayPath);
  }

  return { removed, missing };
}

async function pruneArtifacts(options: {
  root: string;
  purge: boolean;
  targets: ArtifactTarget[];
}): Promise<PruneArtifactSummary> {
  const { root, purge, targets } = options;

  if (!purge || targets.length === 0) {
    return { purged: false, removed: [], missing: [] };
  }

  const removed: string[] = [];
  const missing: string[] = [];

  for (const target of targets) {
    const absolutePath = target.absolutePath;
    if (!absolutePath) {
      missing.push(target.displayPath);
      continue;
    }
    if (!(await pathExists(absolutePath))) {
      missing.push(target.displayPath);
      continue;
    }

    await removeWorkspaceEntry({
      path: absolutePath,
      root,
      recursive: target.type === "directory",
    });
    removed.push(target.displayPath);
  }

  return { purged: true, removed, missing };
}

async function purgeRunDirectoryExceptRecord(options: {
  root: string;
  runRecord: RunRecord;
}): Promise<void> {
  const { root, runRecord } = options;
  const runDir = resolveWorkspacePath(root, VORATIQ_RUNS_DIR, runRecord.runId);
  if (!(await pathExists(runDir))) {
    return;
  }

  const entries = await fs.readdir(runDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === RUN_RECORD_FILENAME) {
      continue;
    }
    const entryPath = resolvePath(runDir, entry.name);
    await removeWorkspaceEntry({
      path: entryPath,
      root,
      recursive: entry.isDirectory(),
    });
  }
}

interface PruneBranchesOptions {
  root: string;
  branches: string[];
}

async function pruneBranches(
  options: PruneBranchesOptions,
): Promise<{ deleted: string[]; skipped: string[] }> {
  const { root, branches } = options;
  const deleted: string[] = [];
  const skipped: string[] = [];

  if (branches.length === 0) {
    return { deleted, skipped };
  }

  await runGitCommand(["worktree", "prune"], { cwd: root });

  for (const branch of branches) {
    if (!(await branchExists(root, branch))) {
      skipped.push(branch);
      continue;
    }

    try {
      await runGitCommand(["branch", "-D", branch], { cwd: root });
      deleted.push(branch);
    } catch (error) {
      const detail = getGitStderr(error) ?? toErrorMessage(error);
      throw new PruneBranchDeletionError(branch, detail);
    }
  }

  return { deleted, skipped };
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  const output = await runGitCommand(["branch", "--list", branch], {
    cwd: root,
  });
  return output.length > 0;
}

interface RewriteHistoryOptions {
  root: string;
  runsFilePath: string;
  runId: string;
  deletedAt: string;
}

async function rewriteHistory(
  options: RewriteHistoryOptions,
): Promise<RunRecord> {
  const { root, runsFilePath, runId, deletedAt } = options;

  try {
    return await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (record) => ({
        ...record,
        status: "pruned",
        deletedAt,
      }),
    });
  } catch (error) {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunMetadataMissingError(runId);
    }
    if (error instanceof RunRecordParseError) {
      throw new RunMetadataMissingError(runId);
    }
    throw error;
  }
}
