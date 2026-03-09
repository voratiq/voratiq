import type { AgentDefinition } from "../../configs/agents/types.js";
import type { CompetitionPlan } from "./resolve-stage-competitors.js";
import { resolveStageCompetitors } from "./resolve-stage-competitors.js";

export interface ResolveReductionCompetitorsInput {
  root: string;
  cliAgentIds?: readonly string[];
  cliOverrideFlag?: string;
  profileName?: string;
  profileFlag?: string;
  includeDefinitions?: boolean;
}

export interface ReductionCompetitionPlan {
  source: "cli" | "orchestration";
  agentIds: readonly string[];
  competitors: readonly AgentDefinition[];
}

export function resolveReductionCompetitors(
  input: ResolveReductionCompetitorsInput,
): ReductionCompetitionPlan {
  const plan: CompetitionPlan = resolveStageCompetitors({
    root: input.root,
    stageId: "reduce",
    cliAgentIds: input.cliAgentIds,
    cliOverrideFlag: input.cliOverrideFlag,
    profileName: input.profileName,
    profileFlag: input.profileFlag,
    includeDefinitions: input.includeDefinitions,
  });

  return plan;
}
