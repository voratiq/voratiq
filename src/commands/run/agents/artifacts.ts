import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import { toErrorMessage } from "../../../utils/errors.js";
import { isFileSystemError } from "../../../utils/fs.js";
import {
  gitAddAll,
  gitCommitAll,
  gitDiff,
  gitDiffShortStat,
  gitHasStagedChanges,
  runGitCommand,
} from "../../../utils/git.js";
import type { SandboxPersona } from "../../../workspace/agents.js";
import { enforceCredentialExclusion } from "../../../workspace/credential-guard.js";
import {
  cleanupWorkspaceDependencies,
  ensureWorkspaceDependencies,
  WorkspaceDependencyCleanupError,
  type WorkspaceDependencyCleanupResult,
} from "../../../workspace/dependencies.js";
import { promoteWorkspaceFile } from "../../../workspace/promotion.js";
import { AgentProcessError, GitOperationError } from "../errors.js";
import {
  type RunAgentWorkspacePaths,
  WORKSPACE_SUMMARY_FILENAME,
} from "./workspace.js";

export interface ArtifactCollectionResult {
  summaryCaptured: boolean;
  diffStatistics?: string;
  commitSha?: string;
  diffAttempted: boolean;
  diffCaptured: boolean;
}

export async function collectAgentArtifacts(options: {
  baseRevisionSha: string;
  workspacePaths: RunAgentWorkspacePaths;
  root: string;
  environment: EnvironmentConfig;
  persona: SandboxPersona;
}): Promise<ArtifactCollectionResult> {
  const { baseRevisionSha, workspacePaths, root, environment, persona } =
    options;

  const { workspacePath, artifactsPath, summaryPath, diffPath } =
    workspacePaths;

  let dependenciesCleanup: WorkspaceDependencyCleanupResult = {
    nodeRemoved: false,
    pythonRemoved: false,
  };
  let cleanupFailed = false;
  try {
    dependenciesCleanup = await cleanupWorkspaceDependencies({
      root,
      workspacePath,
      environment,
    });
  } catch (error) {
    cleanupFailed = true;
    if (error instanceof WorkspaceDependencyCleanupError) {
      dependenciesCleanup = error.cleanup;
    }
  }

  let runFailed = true;
  let artifactResult: ArtifactCollectionResult | undefined;
  let dependencyRestoreError: AgentProcessError | undefined;
  try {
    await runGitStep("Git add failed", async () => gitAddAll(workspacePath));

    const hasChangesBeforeSummary = await gitHasStagedChanges(workspacePath);

    if (!hasChangesBeforeSummary) {
      throw new AgentProcessError({
        detail: "Agent process failed. No workspace changes detected.",
      });
    }

    const { summary } = await harvestSummary({
      workspacePath,
      artifactsPath,
      summaryPath,
    });

    await runGitStep("Git add failed", async () => gitAddAll(workspacePath));

    const hasChanges = await gitHasStagedChanges(workspacePath);

    if (!hasChanges) {
      throw new AgentProcessError({
        detail: "Agent process failed. No workspace changes detected.",
      });
    }

    let diffStatistics: string | undefined;
    let commitSha: string | undefined;

    await runGitStep("Git commit failed", async () =>
      gitCommitAll({
        cwd: workspacePath,
        message: summary,
        authorName: persona.authorName,
        authorEmail: persona.authorEmail,
        bypassHooks: true,
      }),
    );

    commitSha = await runGitStep("Git rev-parse failed", async () =>
      runGitCommand(["rev-parse", "HEAD"], { cwd: workspacePath }),
    );

    const diffContent = await runGitStep("Git diff failed", async () =>
      gitDiff({
        cwd: workspacePath,
        baseRevision: baseRevisionSha,
        targetRevision: "HEAD",
      }),
    );
    await enforceCredentialExclusion({
      workspacePath,
      diffContent,
    });
    await writeFile(diffPath, diffContent, { encoding: "utf8" });

    diffStatistics = await runGitStep("Git diff --shortstat failed", async () =>
      gitDiffShortStat({
        cwd: workspacePath,
        baseRevision: baseRevisionSha,
        targetRevision: "HEAD",
      }),
    );

    runFailed = false;
    artifactResult = {
      summaryCaptured: true,
      diffStatistics,
      commitSha,
      diffAttempted: true,
      diffCaptured: true,
    };
  } finally {
    const cleanupTouched =
      dependenciesCleanup.nodeRemoved || dependenciesCleanup.pythonRemoved;
    const shouldRestoreDependencies = cleanupTouched || cleanupFailed;
    if (shouldRestoreDependencies) {
      try {
        await ensureWorkspaceDependencies({
          root,
          workspacePath,
          environment,
        });
      } catch (error) {
        if (!runFailed) {
          dependencyRestoreError = new AgentProcessError({
            detail: `[voratiq] Failed to restore workspace dependencies after export: ${toErrorMessage(error)}`,
          });
        }
      }
    }
  }

  if (dependencyRestoreError) {
    throw dependencyRestoreError;
  }

  if (!artifactResult) {
    throw new AgentProcessError({
      detail: "Agent process failed before artifacts were collected.",
    });
  }

  return artifactResult;
}

interface HarvestSummaryOptions {
  workspacePath: string;
  artifactsPath: string;
  summaryPath: string;
}

interface HarvestSummaryResult {
  summary: string;
}

const NO_CHANGE_SUMMARY_DETAIL =
  "Agent process failed. No change summary detected." as const;

async function harvestSummary(
  options: HarvestSummaryOptions,
): Promise<HarvestSummaryResult> {
  const { workspacePath, artifactsPath, summaryPath } = options;
  try {
    const { summary } = await promoteSummary({
      workspacePath,
      artifactsPath,
      summaryPath,
    });
    return { summary };
  } catch (error) {
    if (error instanceof AgentProcessError) {
      throw error;
    }
    if (isFileSystemError(error) && error.code === "ENOENT") {
      throw new AgentProcessError({ detail: NO_CHANGE_SUMMARY_DETAIL });
    }
    throw new AgentProcessError({ detail: toErrorMessage(error) });
  }
}

async function promoteSummary(options: {
  workspacePath: string;
  artifactsPath: string;
  summaryPath: string;
}): Promise<{ summary: string }> {
  const { workspacePath, artifactsPath, summaryPath } = options;
  let trimmed: string | undefined;
  const promoteResult = await promoteWorkspaceFile({
    workspacePath,
    artifactsPath,
    stagedRelativePath: WORKSPACE_SUMMARY_FILENAME,
    artifactRelativePath: relative(artifactsPath, summaryPath),
    transform: (raw) => {
      const candidate = raw.toString("utf8").trim();
      if (!candidate) {
        throw new AgentProcessError({
          detail: NO_CHANGE_SUMMARY_DETAIL,
        });
      }
      trimmed = candidate;
      return `${candidate}\n`;
    },
  });

  return {
    summary:
      trimmed ?? (await readFile(promoteResult.artifactPath, "utf8")).trim(),
  };
}

async function runGitStep<T>(
  operationMessage: string,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw new GitOperationError({
      operation: operationMessage,
      detail: toErrorMessage(error),
    });
  }
}
