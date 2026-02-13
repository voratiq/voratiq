import { executeCompetition } from "../../competition/core.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { EvalDefinition } from "../../configs/evals/types.js";
import type { AgentRecordMutators } from "../../runs/records/mutators.js";
import { toError } from "../../utils/errors.js";
import { prepareAgents } from "./agent-preparation.js";
import { runPreparedAgent } from "./agents/lifecycle.js";
import type { PreparedAgentExecution } from "./agents/types.js";
import type { AgentExecutionPhaseResult } from "./phases.js";
import { type AgentExecutionResult, hasEvalFailures } from "./reports.js";

export interface AgentExecutionInput {
  readonly agents: readonly AgentDefinition[];
  readonly baseRevisionSha: string;
  readonly runId: string;
  readonly root: string;
  readonly specContent: string;
  readonly evalPlan: readonly EvalDefinition[];
  readonly effectiveMaxParallel: number;
  readonly mutators: AgentRecordMutators;
  readonly environment: EnvironmentConfig;
}

/**
 * Execute all agents and aggregate results.
 */
export async function executeAgents(
  input: AgentExecutionInput,
): Promise<AgentExecutionPhaseResult> {
  const {
    agents,
    baseRevisionSha,
    runId,
    root,
    specContent,
    evalPlan,
    effectiveMaxParallel,
    mutators,
    environment,
  } = input;

  let executionError: unknown;
  let phaseResult: AgentExecutionPhaseResult | undefined;

  try {
    const sortedExecutions = await executeCompetition<
      AgentDefinition,
      PreparedAgentExecution,
      AgentExecutionResult
    >({
      candidates: agents,
      maxParallel: effectiveMaxParallel,
      queueCandidate: async (candidate) => {
        await mutators.recordAgentQueued(candidate);
      },
      prepareCandidates: async (queuedCandidates) =>
        await prepareAgents({
          agents: queuedCandidates,
          baseRevisionSha,
          runId,
          root,
          specContent,
          evalPlan,
          environment,
        }),
      onPreparationFailure: async (failure) => {
        await mutators.recordAgentSnapshot(failure.record);
      },
      onPreparedCandidate: (execution) => {
        execution.progress = {
          onRunning: mutators.recordAgentSnapshot,
          onCompleted: async (result) => {
            await mutators.recordAgentSnapshot(result.record);
          },
        };
      },
      executePreparedCandidate: async (execution) =>
        await runPreparedAgent(execution),
      sortResults: compareExecutionsByAgentId,
    });

    const agentRecords = sortedExecutions.map((execution) => execution.record);
    const agentReports = sortedExecutions.map((execution) => execution.report);

    const hadAgentFailure = agentReports.some(
      (report) => report.status === "failed",
    );
    const hadEvalFailure = hasEvalFailures(agentReports);

    phaseResult = {
      agentRecords,
      agentReports,
      hadAgentFailure,
      hadEvalFailure,
    };
  } catch (error) {
    executionError = error;
  }

  if (executionError) {
    throw toError(executionError);
  }

  if (!phaseResult) {
    throw new Error(
      `Agent execution did not produce a result for run ${runId}`,
    );
  }

  return phaseResult;
}

function compareExecutionsByAgentId(
  left: AgentExecutionResult,
  right: AgentExecutionResult,
): number {
  return left.record.agentId.localeCompare(right.record.agentId);
}
