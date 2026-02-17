import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import type { RunProgressRenderer } from "../../render/transcripts/run.js";
import { createAgentRecordMutators } from "../../runs/records/mutators.js";
import {
  flushRunRecordBuffer,
  rewriteRunRecord,
} from "../../runs/records/persistence.js";
import type {
  AgentInvocationRecord,
  RunRecord,
  RunReport,
} from "../../runs/records/types.js";
import { toError } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  buildAgentWorkspacePaths,
  formatRunWorkspaceRelative,
} from "../../workspace/layout.js";
import { prepareRunWorkspace } from "../../workspace/run.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { executeAgents } from "./agent-execution.js";
import { generateRunId } from "./id.js";
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
  maxParallel?: number;
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
    maxParallel: requestedMaxParallel,
    renderer,
  } = input;

  const resolution = resolveStageCompetitors({
    root,
    stageId: "run",
    cliAgentIds: agentIds,
    cliOverrideFlag: agentOverrideFlag,
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
      evalPlan: validation.evalPlan,
      effectiveMaxParallel: validation.effectiveMaxParallel,
      environment: validation.environment,
      mutators,
    });

    agentRecords = executionResult.agentRecords;

    const derivedRunStatus: RunRecord["status"] =
      executionResult.hadAgentFailure
        ? "failed"
        : executionResult.agentReports.some(
              (report) => report.status === "errored",
            )
          ? "errored"
          : "succeeded";

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
      throw new AggregateError(
        [executionError, cleanupError],
        `Sandbox teardown failed after run ${runId} error`,
      );
    }
    throw toError(cleanupError);
  }

  if (executionError) {
    throw toError(executionError);
  }

  if (!runReport) {
    throw new Error(`Run ${runId} did not produce a report`);
  }

  await flushRunRecordBuffer({
    runsFilePath,
    runId,
  });

  return runReport;
}
