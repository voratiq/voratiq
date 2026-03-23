import { verifyAgentProviders } from "../../agents/runtime/auth.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";

export function resolveVerificationAgents(options: {
  agentIds?: readonly string[];
  root: string;
  agentOverrideFlag?: string;
  profileName?: string;
}): AgentDefinition[] {
  const { agentIds, root, agentOverrideFlag, profileName } = options;

  try {
    const resolution = resolveStageCompetitors({
      root,
      stageId: "verify",
      cliAgentIds: agentIds,
      cliOverrideFlag: agentOverrideFlag,
      profileName,
    });
    return [...resolution.competitors];
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new Error(`Verifier agent not found: ${error.agentId}`);
    }
    throw error;
  }
}

export async function assertVerifierPreflight(
  agents: readonly AgentDefinition[],
): Promise<void> {
  const providerIssues = await verifyAgentProviders(
    agents.map((agent) => ({ id: agent.id, provider: agent.provider })),
  );
  if (providerIssues.length > 0) {
    const detail = providerIssues.map((issue) => issue.message).join("; ");
    throw new Error(`Verifier preflight failed: ${detail}`);
  }
}
