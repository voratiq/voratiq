import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { createTeardownController } from "../../competition/shared/teardown.js";
import { executeAgents } from "../../domain/run/competition/agent-execution.js";
import {
  RunCommandError,
  RunProcessStreamError,
} from "../../domain/run/competition/errors.js";
import { toRunReport } from "../../domain/run/competition/reports.js";
import { generateRunId } from "../../domain/run/model/id.js";
import { createAgentRecordMutators } from "../../domain/run/model/mutators.js";
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
import {
  type AgentWorkspacePaths,
  buildAgentWorkspacePaths,
  formatRunWorkspaceRelative,
} from "../../workspace/layout.js";
import { prepareRunWorkspace } from "../../workspace/run.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { finalizeActiveRun, registerActiveRun } from "./lifecycle.js";
import { initializeRunRecord } from "./record-init.js";
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
  const startedAt = new Date().toISOString();
  const createdAt = startedAt;
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
    startedAt,
    runRoot,
    ...buildPersistedExtraContextFields(extraContextFiles),
  });

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
    registerRunWorkspaceTeardown(teardown, workspacePaths, agent.id);
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
    teardown,
    agents: agentAbortContexts,
  });

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
          agents: agentRecords,
          status: derivedRunStatus,
          ...buildRecordLifecycleCompleteFields({ existing }),
          deletedAt: null,
        };
      },
    });

    runReport = toRunReport(
      updatedRunRecord,
      executionResult.agentReports,
      executionResult.hadAgentFailure,
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
              ...buildRecordLifecycleCompleteFields({ existing }),
              deletedAt: null,
            };
          },
        });
      } catch {
        // Ignore secondary failures while preserving the original error.
      }
    }
  } finally {
    await finalizeActiveRun(runId);
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

function registerRunWorkspaceTeardown(
  teardown: ReturnType<typeof createTeardownController>,
  workspacePaths: AgentWorkspacePaths,
  agentId: string,
): void {
  teardown.addPath(workspacePaths.contextPath, `${agentId} context`);
  teardown.addPath(workspacePaths.runtimePath, `${agentId} runtime`);
  teardown.addPath(workspacePaths.sandboxPath, `${agentId} sandbox`);
}
