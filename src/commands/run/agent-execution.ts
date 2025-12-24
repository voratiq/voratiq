import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { EvalDefinition } from "../../configs/evals/types.js";
import type { AgentRecordMutators } from "../../records/mutators.js";
import { toError } from "../../utils/errors.js";
import { prepareAgents, runAgentsWithLimit } from "./agents.js";
import type { AgentExecutionPhaseResult } from "./phases.js";
import { type AgentExecutionResult, hasEvalFailures } from "./reports.js";

export interface AgentExecutionInput {
  readonly agents: readonly AgentDefinition[];
  readonly baseRevisionSha: string;
  readonly runId: string;
  readonly root: string;
  readonly prompt: string;
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
    prompt,
    evalPlan,
    effectiveMaxParallel,
    mutators,
    environment,
  } = input;

  let executionError: unknown;
  let phaseResult: AgentExecutionPhaseResult | undefined;

  try {
    for (const agent of agents) {
      await mutators.recordAgentQueued(agent);
    }

    const { ready: preparedAgents, failures: preparationFailures } =
      await prepareAgents({
        agents,
        baseRevisionSha,
        runId,
        root,
        prompt,
        evalPlan,
        environment,
      });

    for (const failure of preparationFailures) {
      await mutators.recordAgentSnapshot(failure.record);
    }

    for (const execution of preparedAgents) {
      execution.progress = {
        onRunning: mutators.recordAgentSnapshot,
        onCompleted: async (result) => {
          await mutators.recordAgentSnapshot(result.record);
        },
      };
    }

    const executionResults =
      preparedAgents.length > 0 && effectiveMaxParallel > 0
        ? await runAgentsWithLimit(preparedAgents, effectiveMaxParallel)
        : [];

    const agentExecutions = [...preparationFailures, ...executionResults];
    const sortedExecutions = sortExecutions(agentExecutions);
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

function sortExecutions(
  executions: AgentExecutionResult[],
): AgentExecutionResult[] {
  return [...executions].sort((a, b) =>
    a.record.agentId.localeCompare(b.record.agentId),
  );
}
