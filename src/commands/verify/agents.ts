import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { VerifyAgentNotFoundError } from "./errors.js";

export function resolveVerificationAgents(options: {
  agentIds?: readonly string[];
  root: string;
  agentOverrideFlag?: string;
  profileName?: string;
}): {
  readonly agentIds: readonly string[];
  readonly competitors: readonly AgentDefinition[];
} {
  const { agentIds, root, agentOverrideFlag, profileName } = options;

  try {
    return resolveStageCompetitors({
      root,
      stageId: "verify",
      cliAgentIds: agentIds,
      cliOverrideFlag: agentOverrideFlag,
      profileName,
      includeDefinitions: false,
    });
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new VerifyAgentNotFoundError(error.agentId);
    }
    throw error;
  }
}
