import { runPreparedWithLimit } from "../../../competition/core.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { AgentExecutionResult } from "../../../domain/run/competition/reports.js";
import { prepareAgentForExecution } from "./agents/preparation.js";
import type {
  AgentPreparationOutcome,
  AgentPreparationResult,
  PreparedAgentExecution,
} from "./agents/types.js";

const RUN_WORKSPACE_PREPARATION_MAX_PARALLEL = 2;

export async function prepareAgents(options: {
  agents: readonly AgentDefinition[];
  baseRevisionSha: string;
  runId: string;
  root: string;
  specContent: string;
  extraContextFiles: readonly import("../../../competition/shared/extra-context.js").ResolvedExtraContextFile[];
  environment: EnvironmentConfig;
}): Promise<AgentPreparationResult> {
  const {
    agents,
    baseRevisionSha,
    runId,
    root,
    specContent,
    extraContextFiles,
    environment,
  } = options;

  const outcomes = await runPreparedWithLimit<
    AgentDefinition,
    AgentPreparationOutcome
  >({
    prepared: agents,
    maxParallel: RUN_WORKSPACE_PREPARATION_MAX_PARALLEL,
    executePrepared: async (agent) =>
      await prepareAgentForExecution({
        agent,
        baseRevisionSha,
        runId,
        root,
        specContent,
        extraContextFiles,
        environment,
      }),
  });

  return splitPreparationOutcomes(outcomes);
}

function splitPreparationOutcomes(
  outcomes: readonly AgentPreparationOutcome[],
): AgentPreparationResult {
  const ready: PreparedAgentExecution[] = [];
  const failures: AgentExecutionResult[] = [];

  for (const outcome of outcomes) {
    if (outcome.status === "ready") {
      ready.push(outcome.prepared);
      continue;
    }

    failures.push(outcome.result);
  }

  return { ready, failures };
}
