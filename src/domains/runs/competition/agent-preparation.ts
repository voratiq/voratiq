import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { EvalDefinition } from "../../../configs/evals/types.js";
import type { AgentExecutionResult } from "../../../domains/runs/competition/reports.js";
import { prepareAgentForExecution } from "./agents/preparation.js";
import type {
  AgentPreparationResult,
  PreparedAgentExecution,
} from "./agents/types.js";

export async function prepareAgents(options: {
  agents: readonly AgentDefinition[];
  baseRevisionSha: string;
  runId: string;
  root: string;
  specContent: string;
  extraContextFiles: readonly import("../../../competition/shared/extra-context.js").ResolvedExtraContextFile[];
  evalPlan: readonly EvalDefinition[];
  environment: EnvironmentConfig;
}): Promise<AgentPreparationResult> {
  const {
    agents,
    baseRevisionSha,
    runId,
    root,
    specContent,
    extraContextFiles,
    evalPlan,
    environment,
  } = options;

  const ready: PreparedAgentExecution[] = [];
  const failures: AgentExecutionResult[] = [];

  for (const agent of agents) {
    const preparation = await prepareAgentForExecution({
      agent,
      baseRevisionSha,
      runId,
      root,
      specContent,
      extraContextFiles,
      evalPlan,
      environment,
    });
    if (preparation.status === "ready") {
      ready.push(preparation.prepared);
    } else {
      failures.push(preparation.result);
    }
  }

  return { ready, failures };
}
