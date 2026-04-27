import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { createTeardownController } from "../../competition/shared/teardown.js";
import { executeAgents } from "../../domain/run/competition/agent-execution.js";
import {
  RunCommandError,
  RunProcessStreamError,
} from "../../domain/run/competition/errors.js";
import {
  type AgentExecutionState,
  toAgentReport,
  toRunReport,
} from "../../domain/run/competition/reports.js";
import { generateRunId } from "../../domain/run/model/id.js";
import {
  createAgentRecordMutators,
  mergeAgentRecords,
} from "../../domain/run/model/mutators.js";
import type {
  AgentInvocationRecord,
  RunRecord,
  RunReport,
} from "../../domain/run/model/types.js";
import {
  flushRunRecordBuffer,
  rewriteRunRecord,
} from "../../domain/run/persistence/adapter.js";
import { buildRecordLifecycleCompleteFields } from "../../domain/shared/lifecycle.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import type { RunProgressRenderer } from "../../render/transcripts/run.js";
import { deriveRunStatusFromAgents } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import { getAgentManifestPath } from "../../workspace/artifact-paths.js";
import {
  type AgentWorkspacePaths,
  buildAgentWorkspacePaths,
  formatRunWorkspaceRelative,
} from "../../workspace/layout.js";
import { prepareRunWorkspace } from "../../workspace/run.js";
import { getAgentDirectoryPath } from "../../workspace/session-paths.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import {
  clearActiveRun,
  finalizeActiveRun,
  markActiveRunRecordPersisted,
  registerActiveRun,
} from "./lifecycle.js";
import { initializeRunRecord } from "./record-init.js";
import { normalizeRunSpecPath } from "./spec-path.js";
import { validateAndPrepare } from "./validation.js";

export interface RunCommandInput {
  root: string;
  runsFilePath: string;
  specsFilePath?: string;
  specAbsolutePath: string;
  specDisplayPath: string;
  agentIds?: readonly string[];
  agentOverrideFlag?: string;
  profileName?: string;
  maxParallel?: number;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
  renderer?: RunProgressRenderer;
}

/**
 * Execute a complete run: validate inputs, prepare workspace, execute agents, and finalize report.
 */
export async function executeRunCommand(
  input: RunCommandInput,
): Promise<RunReport> {
  const {
    root,
    runsFilePath,
    specsFilePath,
    specAbsolutePath,
    specDisplayPath,
    agentIds,
    agentOverrideFlag,
    profileName,
    maxParallel: requestedMaxParallel,
    extraContextFiles = [],
    renderer,
  } = input;

  const resolution = resolveStageCompetitors({
    root,
    stageId: "run",
    cliAgentIds: agentIds,
    cliOverrideFlag: agentOverrideFlag,
    profileName,
    includeDefinitions: false,
  });

  const {
    specAbsolutePath: effectiveSpecAbsolutePath,
    specDisplayPath: effectiveSpecDisplayPath,
  } = await normalizeRunSpecPath({
    root,
    specAbsolutePath,
    specDisplayPath,
  });

  const validation = await validateAndPrepare({
    root,
    specAbsolutePath: effectiveSpecAbsolutePath,
    specDisplayPath: effectiveSpecDisplayPath,
    specsFilePath,
    resolvedAgentIds: resolution.agentIds,
    maxParallel: requestedMaxParallel,
  });

  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const createdAt = startedAt;
  const repoDisplayPath = normalizePathForDisplay(relativeToRoot(root, root));
  const { runWorkspace } = await prepareRunWorkspace({
    root,
    runId,
  });

  const runRoot = runWorkspace.absolute;

  const teardown = createTeardownController(`run \`${runId}\``);
  teardown.addAction({
    key: `run-auth:${runId}`,
    label: "session auth",
    cleanup: async () => {
      await teardownSessionAuth(runId);
    },
  });

  const agentAbortContexts = validation.agents.map((agent) => {
    const workspacePaths = buildAgentWorkspacePaths({
      root,
      runId,
      agentId: agent.id,
    });
    registerRunWorkspaceTeardown(
      teardown,
      root,
      workspacePaths,
      runId,
      agent.id,
    );
    return {
      agentId: agent.id,
      providerId: agent.provider,
      agentRoot: workspacePaths.agentRoot,
    };
  });

  let resolveRecordInit!: (persisted: boolean) => void;
  const recordInitPromise = new Promise<boolean>((resolve) => {
    resolveRecordInit = resolve;
  });

  registerActiveRun({
    root,
    runsFilePath,
    runId,
    recordPersisted: false,
    recordInitPromise,
    teardown,
    agents: agentAbortContexts,
  });

  let recordPersisted = false;
  try {
    ({ recordPersisted } = await initializeRunRecord({
      root,
      runsFilePath,
      runId,
      specDisplayPath: effectiveSpecDisplayPath,
      specTarget: validation.specTarget,
      baseRevisionSha: validation.baseRevisionSha,
      repoDisplayPath,
      createdAt,
      startedAt,
      runRoot,
      ...buildPersistedExtraContextFields(extraContextFiles),
    }));
    resolveRecordInit(recordPersisted);
    if (recordPersisted) {
      markActiveRunRecordPersisted(runId);
    }
  } catch (error) {
    resolveRecordInit(false);
    clearActiveRun(runId);
    throw error;
  }

  if (renderer) {
    renderer.begin({
      runId,
      status: "running",
      workspacePath: formatRunWorkspaceRelative(runId),
      createdAt,
      startedAt,
    });
  }

  const mutators = createAgentRecordMutators({
    root,
    runsFilePath,
    runId,
    renderer,
  });

  let agentRecords: AgentInvocationRecord[] = [];

  let executionError: unknown;
  let flushError: unknown;
  let finalizeError: unknown;
  let runReport: RunReport | undefined;

  try {
    const executionResult = await executeAgents({
      agents: validation.agents,
      baseRevisionSha: validation.baseRevisionSha,
      runId,
      root,
      specContent: validation.specContent,
      extraContextFiles,
      effectiveMaxParallel: validation.effectiveMaxParallel,
      environment: validation.environment,
      mutators,
    });

    agentRecords = executionResult.agentRecords;

    const derivedRunStatus: RunRecord["status"] = deriveRunStatusFromAgents(
      executionResult.agentReports.map((report) => report.status),
    );

    const updatedRunRecord = await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (existing) => {
        if (existing.status === "aborted") {
          return existing;
        }

        return {
          ...existing,
          agents: mergeFinalAgentRecords(existing.agents, agentRecords),
          status: derivedRunStatus,
          ...buildRecordLifecycleCompleteFields({ existing }),
        };
      },
    });

    const finalAgentReports = reconcileAgentReports(
      runId,
      updatedRunRecord,
      executionResult.agentReports,
    );
    runReport = toRunReport(
      updatedRunRecord,
      finalAgentReports,
      finalAgentReports.some(
        (agent) => agent.status === "failed" || agent.status === "errored",
      ),
    );
  } catch (error) {
    executionError = error;
    if (recordPersisted) {
      try {
        await rewriteRunRecord({
          root,
          runsFilePath,
          runId,
          mutate: (existing) => {
            if (existing.status === "aborted") {
              return existing;
            }

            return {
              ...existing,
              agents:
                agentRecords.length > 0
                  ? mergeFinalAgentRecords(existing.agents, agentRecords)
                  : existing.agents,
              status: "errored",
              ...buildRecordLifecycleCompleteFields({ existing }),
            };
          },
        });
      } catch {
        // Ignore secondary failures while preserving the original error.
      }
    }
  }

  try {
    await flushRunRecordBuffer({
      runsFilePath,
      runId,
    });
  } catch (error) {
    flushError = error;
  }

  try {
    await finalizeActiveRun(runId);
  } catch (error) {
    finalizeError = error;
  }

  if (executionError) {
    if (executionError instanceof RunCommandError) {
      throw executionError;
    }
    throw new RunProcessStreamError(toErrorMessage(executionError));
  }

  if (flushError) {
    throw new RunProcessStreamError(toErrorMessage(flushError));
  }

  if (finalizeError) {
    if (!runReport) {
      throw new RunProcessStreamError(toErrorMessage(finalizeError));
    }
    console.warn(
      `[voratiq] Run \`${runId}\` completed, but post-run cleanup failed: ${toErrorMessage(finalizeError)}`,
    );
  }

  if (!runReport) {
    throw new RunProcessStreamError(
      `Run \`${runId}\` did not produce a report.`,
    );
  }

  return runReport;
}

function registerRunWorkspaceTeardown(
  teardown: ReturnType<typeof createTeardownController>,
  root: string,
  workspacePaths: AgentWorkspacePaths,
  runId: string,
  agentId: string,
): void {
  teardown.addWorktree({
    root,
    worktreePath: workspacePaths.workspacePath,
    label: `${agentId} workspace`,
  });
  teardown.addPath(workspacePaths.contextPath, `${agentId} context`);
  teardown.addPath(workspacePaths.runtimePath, `${agentId} runtime`);
  teardown.addPath(workspacePaths.sandboxPath, `${agentId} sandbox`);
  teardown.addBranch({
    root,
    branch: `voratiq/run/${runId}/${agentId}`,
    worktreePath: workspacePaths.workspacePath,
    label: `${agentId} branch`,
  });
}

function mergeFinalAgentRecords(
  existing: readonly AgentInvocationRecord[],
  incoming: readonly AgentInvocationRecord[],
): AgentInvocationRecord[] {
  const merged = new Map<string, AgentInvocationRecord>();

  for (const agent of existing) {
    merged.set(agent.agentId, agent);
  }

  for (const agent of incoming) {
    merged.set(
      agent.agentId,
      mergeAgentRecords(merged.get(agent.agentId), agent),
    );
  }

  return [...merged.values()];
}

function reconcileAgentReports(
  runId: string,
  record: RunRecord,
  reports: RunReport["agents"],
): RunReport["agents"] {
  const reportsByAgentId = new Map(
    reports.map((report) => [report.agentId, report]),
  );

  return record.agents.map((agent) => {
    const existingReport = reportsByAgentId.get(agent.agentId);
    if (!existingReport) {
      return {
        agentId: agent.agentId,
        status: agent.status,
        tokenUsage: agent.tokenUsage,
        tokenUsageResult: {
          status: "unavailable",
          reason: "chat_not_captured",
          provider: "unknown",
          modelId: agent.model,
        },
        runtimeManifestPath: getAgentManifestPath(runId, agent.agentId),
        baseDirectory: getAgentDirectoryPath(runId, agent.agentId),
        assets: {},
        startedAt: agent.startedAt ?? record.startedAt ?? record.createdAt,
        completedAt:
          agent.completedAt ??
          record.completedAt ??
          agent.startedAt ??
          record.startedAt ??
          record.createdAt,
        diffStatistics: agent.diffStatistics,
        error: agent.error,
        warnings: agent.warnings,
        diffAttempted: false,
        diffCaptured: false,
      };
    }

    const derivations: AgentExecutionState = {
      diffAttempted: existingReport.diffAttempted,
      diffCaptured: existingReport.diffCaptured,
      diffStatistics: existingReport.diffStatistics,
      tokenUsage: existingReport.tokenUsage,
      tokenUsageResult: existingReport.tokenUsageResult,
    };

    return toAgentReport(runId, agent, derivations);
  });
}
