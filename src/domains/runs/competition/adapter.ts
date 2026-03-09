import type { AgentExecutionResult } from "../../../domains/runs/competition/reports.js";
import type { ResolvedExtraContextFile } from "../../../competition/shared/extra-context.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../../competition/command-adapter.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { EvalDefinition } from "../../../configs/evals/types.js";
import { prepareAgents } from "../../../domains/runs/competition/agent-preparation.js";
import { runPreparedAgent } from "../../../domains/runs/competition/agents/lifecycle.js";
import type { PreparedAgentExecution } from "../../../domains/runs/competition/agents/types.js";
import type { AgentRecordMutators } from "../../../domains/runs/model/mutators.js";

export interface CreateRunCompetitionAdapterInput {
  readonly baseRevisionSha: string;
  readonly runId: string;
  readonly root: string;
  readonly specContent: string;
  readonly extraContextFiles?: readonly ResolvedExtraContextFile[];
  readonly evalPlan: readonly EvalDefinition[];
  readonly mutators: AgentRecordMutators;
  readonly environment: EnvironmentConfig;
}

interface RunCompetitionAdapterDependencies {
  readonly prepareCandidates: (options: {
    agents: readonly AgentDefinition[];
    baseRevisionSha: string;
    runId: string;
    root: string;
    specContent: string;
    extraContextFiles: readonly ResolvedExtraContextFile[];
    evalPlan: readonly EvalDefinition[];
    environment: EnvironmentConfig;
  }) => Promise<
    CompetitionPreparationResult<PreparedAgentExecution, AgentExecutionResult>
  >;
  readonly executePrepared: (
    execution: PreparedAgentExecution,
  ) => Promise<AgentExecutionResult>;
}

export function createRunCompetitionAdapter(
  input: CreateRunCompetitionAdapterInput,
  dependencies: Partial<RunCompetitionAdapterDependencies> = {},
): CompetitionCommandAdapter<
  AgentDefinition,
  PreparedAgentExecution,
  AgentExecutionResult
> {
  const {
    baseRevisionSha,
    runId,
    root,
    specContent,
    extraContextFiles = [],
    evalPlan,
    mutators,
    environment,
  } = input;
  const prepareCandidates =
    dependencies.prepareCandidates ??
    (async (options) => await prepareAgents(options));
  const executePrepared =
    dependencies.executePrepared ??
    (async (execution) => await runPreparedAgent(execution));

  return {
    queueCandidate: async (candidate) => {
      await mutators.recordAgentQueued(candidate);
    },
    prepareCandidates: async (agents) =>
      await prepareCandidates({
        agents,
        baseRevisionSha,
        runId,
        root,
        specContent,
        extraContextFiles,
        evalPlan,
        environment,
      }),
    onPreparationFailure: async (failure) => {
      await mutators.recordAgentSnapshot(failure.record);
    },
    onCandidatePrepared: (execution) => {
      execution.progress = {
        onRunning: mutators.recordAgentSnapshot,
        onCompleted: async (result) => {
          await mutators.recordAgentSnapshot(result.record);
        },
      };
    },
    executeCandidate: async (execution) => await executePrepared(execution),
    sortResults: compareExecutionsByAgentId,
  };
}

function compareExecutionsByAgentId(
  left: AgentExecutionResult,
  right: AgentExecutionResult,
): number {
  return left.record.agentId.localeCompare(right.record.agentId);
}
