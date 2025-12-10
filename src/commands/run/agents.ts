import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { EvalDefinition } from "../../configs/evals/types.js";
import { runPreparedAgent } from "./agents/lifecycle.js";
import { prepareAgentForExecution } from "./agents/preparation.js";
import type {
  AgentPreparationResult,
  PreparedAgentExecution,
} from "./agents/types.js";
import type { AgentExecutionResult } from "./reports.js";

export async function prepareAgents(options: {
  agents: readonly AgentDefinition[];
  baseRevisionSha: string;
  runId: string;
  root: string;
  evalPlan: readonly EvalDefinition[];
  environment: EnvironmentConfig;
}): Promise<AgentPreparationResult> {
  const { agents, baseRevisionSha, runId, root, evalPlan, environment } =
    options;

  const ready: PreparedAgentExecution[] = [];
  const failures: AgentExecutionResult[] = [];

  for (const agent of agents) {
    const preparation = await prepareAgentForExecution({
      agent,
      baseRevisionSha,
      runId,
      root,
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

export async function runAgentsWithLimit(
  agents: PreparedAgentExecution[],
  limit: number,
): Promise<AgentExecutionResult[]> {
  if (agents.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(limit, agents.length));
  const results = new Array<AgentExecutionResult>(agents.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= agents.length) {
        return;
      }
      results[current] = await runPreparedAgent(agents[current]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let index = 0; index < workerCount; index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}
