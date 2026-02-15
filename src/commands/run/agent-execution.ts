import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { EvalDefinition } from "../../configs/evals/types.js";
import type { AgentRecordMutators } from "../../runs/records/mutators.js";
import { toError } from "../../utils/errors.js";
import { createRunCompetitionAdapter } from "./competition-adapter.js";
import type { AgentExecutionPhaseResult } from "./phases.js";
import { hasEvalFailures } from "./reports.js";

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
    const sortedExecutions = await executeCompetitionWithAdapter({
      candidates: agents,
      maxParallel: effectiveMaxParallel,
      adapter: createRunCompetitionAdapter({
        baseRevisionSha,
        runId,
        root,
        specContent,
        evalPlan,
        mutators,
        environment,
      }),
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
