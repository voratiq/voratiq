import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import { executeAgents } from "../../domains/runs/competition/agent-execution.js";
import { generateRunId } from "../../domains/runs/model/id.js";
import { createAgentRecordMutators } from "../../domains/runs/model/mutators.js";
import type {
  AgentInvocationRecord,
  RunRecord,
  RunReport,
} from "../../domains/runs/model/types.js";
import {
  flushRunRecordBuffer,
  rewriteRunRecord,
} from "../../domains/runs/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import type { RunProgressRenderer } from "../../render/transcripts/run.js";
import { deriveRunStatusFromAgents } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  buildAgentWorkspacePaths,
  formatRunWorkspaceRelative,
} from "../../workspace/layout.js";
import { prepareRunWorkspace } from "../../workspace/run.js";
import type { ResolvedExtraContextFile } from "../shared/extra-context.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { RunCommandError, RunProcessStreamError } from "./errors.js";
import { clearActiveRun, registerActiveRun } from "./lifecycle.js";
import { initializeRunRecord } from "./record-init.js";
import { toRunReport } from "./reports.js";
import { validateAndPrepare } from "./validation.js";

export interface RunCommandInput {
  root: string;
  runsFilePath: string;
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

  const validation = await validateAndPrepare({
    root,
    specAbsolutePath,
    resolvedAgentIds: resolution.agentIds,
    maxParallel: requestedMaxParallel,
  });

  const runId = generateRunId();
  const createdAt = new Date().toISOString();
  const repoDisplayPath = normalizePathForDisplay(relativeToRoot(root, root));

  const { runWorkspace } = await prepareRunWorkspace({
    root,
    runId,
  });

  const runRoot = runWorkspace.absolute;

  const { recordPersisted } = await initializeRunRecord({
    root,
    runsFilePath,
    runId,
    specDisplayPath,
    baseRevisionSha: validation.baseRevisionSha,
    repoDisplayPath,
    createdAt,
    runRoot,
    ...buildPersistedExtraContextFields(extraContextFiles),
  });

  const agentAbortContexts = validation.agents.map((agent) => {
    const workspacePaths = buildAgentWorkspacePaths({
      root,
      runId,
      agentId: agent.id,
    });
    return {
      agentId: agent.id,
      providerId: agent.provider,
      agentRoot: workspacePaths.agentRoot,
    };
  });

  registerActiveRun({
    root,
    runsFilePath,
    runId,
    agents: agentAbortContexts,
  });

  if (renderer) {
    renderer.begin({
      runId,
      status: "running",
      specPath: specDisplayPath,
      workspacePath: formatRunWorkspaceRelative(runId),
      createdAt,
      baseRevisionSha: validation.baseRevisionSha,
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
  let cleanupError: unknown;
  let runReport: RunReport | undefined;

  try {
    const executionResult = await executeAgents({
      agents: validation.agents,
      baseRevisionSha: validation.baseRevisionSha,
      runId,
      root,
      specContent: validation.specContent,
      extraContextFiles,
      evalPlan: validation.evalPlan,
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
          agents: agentRecords,
          status: derivedRunStatus,
          deletedAt: null,
        };
      },
    });

    runReport = toRunReport(
      updatedRunRecord,
      executionResult.agentReports,
      executionResult.hadAgentFailure,
      executionResult.hadEvalFailure,
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
              agents: agentRecords.length > 0 ? agentRecords : existing.agents,
              status: "errored",
              deletedAt: null,
            };
          },
        });
      } catch {
        // Ignore secondary failures while preserving the original error.
      }
    }
  } finally {
    try {
      await teardownSessionAuth(runId);
    } catch (error) {
      cleanupError = error;
    } finally {
      clearActiveRun(runId);
    }
  }

  if (cleanupError) {
    if (executionError) {
      throw new RunProcessStreamError(
        `Run \`${runId}\` failed and cleanup also failed: ${toErrorMessage(cleanupError)}`,
      );
    }
    throw new RunProcessStreamError(
      `Run \`${runId}\` cleanup failed: ${toErrorMessage(cleanupError)}`,
    );
  }

  if (executionError) {
    if (executionError instanceof RunCommandError) {
      throw executionError;
    }
    throw new RunProcessStreamError(toErrorMessage(executionError));
  }

  if (!runReport) {
    throw new RunProcessStreamError(
      `Run \`${runId}\` did not produce a report.`,
    );
  }

  await flushRunRecordBuffer({
    runsFilePath,
    runId,
  });

  return runReport;
}
