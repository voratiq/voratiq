import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { EnvironmentConfig } from "../../../../configs/environment/types.js";
import {
  AgentProcessError,
  GitOperationError,
} from "../../../../domain/run/competition/errors.js";
import { toErrorMessage } from "../../../../utils/errors.js";
import { isFileSystemError } from "../../../../utils/fs.js";
import {
  gitAddAll,
  gitCommitAll,
  gitDiff,
  gitDiffShortStat,
  gitHasStagedChanges,
  runGitCommand,
} from "../../../../utils/git.js";
import type { SandboxPersona } from "../../../../workspace/agents.js";
import { enforceCredentialExclusion } from "../../../../workspace/credential-guard.js";
import {
  cleanupWorkspaceDependencies,
  ensureWorkspaceDependencies,
  WorkspaceDependencyCleanupError,
  type WorkspaceDependencyCleanupResult,
} from "../../../../workspace/dependencies.js";
import { promoteWorkspaceFile } from "../../../../workspace/promotion.js";
import { WORKSPACE_SHIM_RELATIVE_PATH } from "../../../../workspace/shim.js";
import {
  type RunAgentWorkspacePaths,
  WORKSPACE_SUMMARY_FILENAME,
} from "./workspace.js";

const EXPORT_EXCLUDED_PATHS = [WORKSPACE_SHIM_RELATIVE_PATH.join("/")];

export interface ArtifactCollectionResult {
  summaryCaptured: boolean;
  warnings?: string[];
  diffStatistics?: string;
  commitSha?: string;
  diffAttempted: boolean;
  diffCaptured: boolean;
}

const MISSING_SUMMARY_WARNING =
  "Agent did not produce a change summary." as const;
const INTERNAL_EXPORT_COMMIT_MESSAGE = "voratiq internal export" as const;

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
  try {
    dependenciesCleanup = await cleanupWorkspaceDependencies({
      root,
      workspacePath,
      environment,
      stageId: "run",
    });
  } catch (error) {
    if (error instanceof WorkspaceDependencyCleanupError) {
      dependenciesCleanup = error.cleanup;
    }
  }

  let runFailed = true;
  let artifactResult: ArtifactCollectionResult | undefined;
  let dependencyRestoreError: AgentProcessError | undefined;
  try {
    await runGitStep("Git add failed", async () =>
      gitAddAll(workspacePath, EXPORT_EXCLUDED_PATHS),
    );

    const hasChangesBeforeSummary = await gitHasStagedChanges(workspacePath);

    if (!hasChangesBeforeSummary) {
      throw new AgentProcessError({
        detail: "Agent process failed. No workspace changes detected.",
      });
    }

    const summaryResult = await harvestSummary({
      workspacePath,
      artifactsPath,
      summaryPath,
    });

    await runGitStep("Git add failed", async () =>
      gitAddAll(workspacePath, EXPORT_EXCLUDED_PATHS),
    );

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
        message: summaryResult.commitMessage,
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
      summaryCaptured: summaryResult.summaryCaptured,
      ...(summaryResult.warnings ? { warnings: summaryResult.warnings } : {}),
      diffStatistics,
      commitSha,
      diffAttempted: true,
      diffCaptured: true,
    };
  } finally {
    const nodeConfig =
      environment.node && typeof environment.node === "object"
        ? environment.node
        : null;
    const pythonConfig =
      environment.python && typeof environment.python === "object"
        ? environment.python
        : null;
    const shouldRestoreNode =
      Boolean(nodeConfig) && dependenciesCleanup.nodeRemoved;
    const shouldRestorePython =
      Boolean(pythonConfig) && dependenciesCleanup.pythonRemoved;

    if (shouldRestoreNode || shouldRestorePython) {
      const restoreEnvironment: EnvironmentConfig = {};
      if (shouldRestoreNode && nodeConfig) {
        restoreEnvironment.node = nodeConfig;
      }
      if (shouldRestorePython && pythonConfig) {
        restoreEnvironment.python = pythonConfig;
      }

      try {
        await ensureWorkspaceDependencies({
          root,
          workspacePath,
          environment: restoreEnvironment,
          stageId: "run",
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
  summaryCaptured: boolean;
  commitMessage: string;
  warnings?: string[];
}

async function harvestSummary(
  options: HarvestSummaryOptions,
): Promise<HarvestSummaryResult> {
  try {
    const promoted = await promoteSummary(options);
    if (promoted.kind === "captured") {
      return {
        summaryCaptured: true,
        commitMessage: promoted.summary,
      };
    }

    return {
      summaryCaptured: false,
      commitMessage: INTERNAL_EXPORT_COMMIT_MESSAGE,
      warnings: [MISSING_SUMMARY_WARNING],
    };
  } catch (error) {
    if (error instanceof AgentProcessError) {
      throw error;
    }
    throw new AgentProcessError({ detail: toErrorMessage(error) });
  }
}

type PromoteSummaryResult =
  | { kind: "captured"; summary: string }
  | { kind: "missing" }
  | { kind: "empty" };

async function promoteSummary(options: {
  workspacePath: string;
  artifactsPath: string;
  summaryPath: string;
}): Promise<PromoteSummaryResult> {
  const { workspacePath, artifactsPath, summaryPath } = options;
  const stagedSummaryPath = join(workspacePath, WORKSPACE_SUMMARY_FILENAME);

  let rawSummary: string;
  try {
    rawSummary = await readFile(stagedSummaryPath, "utf8");
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      await discardSummaryArtifacts({
        stagedSummaryPath,
        summaryPath,
      });
      return { kind: "missing" };
    }
    throw error;
  }

  const trimmed = rawSummary.trim();
  if (!trimmed) {
    await discardSummaryArtifacts({
      stagedSummaryPath,
      summaryPath,
    });
    return { kind: "empty" };
  }

  await promoteWorkspaceFile({
    workspacePath,
    artifactsPath,
    stagedRelativePath: WORKSPACE_SUMMARY_FILENAME,
    artifactRelativePath: relative(artifactsPath, summaryPath),
    transform: () => `${trimmed}\n`,
  });

  return {
    kind: "captured",
    summary: trimmed,
  };
}

async function discardSummaryArtifacts(options: {
  stagedSummaryPath: string;
  summaryPath: string;
}): Promise<void> {
  const { stagedSummaryPath, summaryPath } = options;
  await rm(stagedSummaryPath, { force: true }).catch(() => {});
  await rm(summaryPath, { force: true }).catch(() => {});
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
