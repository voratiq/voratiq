import type { AgentConfigEntry, AgentsConfig } from "../agents/types.js";

const ORCHESTRATION_BOOTSTRAP_STAGE_IDS = ["spec", "run", "review"] as const;

export function collectEnabledAgentIdsForBootstrap(
  agents: readonly Pick<AgentConfigEntry, "id" | "enabled">[],
): string[] {
  const seen = new Set<string>();
  const enabledAgentIds: string[] = [];

  for (const entry of agents) {
    if (entry.enabled === false) {
      continue;
    }

    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    enabledAgentIds.push(entry.id);
  }

  return enabledAgentIds;
}

export function serializeDefaultOrchestrationYaml(
  enabledAgentIds: readonly string[],
): string {
  const lines = ["profiles:", "  default:"];

  for (const [
    stageIndex,
    stageId,
  ] of ORCHESTRATION_BOOTSTRAP_STAGE_IDS.entries()) {
    lines.push(`    ${stageId}:`);

    const stageAgents = stageId === "run" ? enabledAgentIds : [];
    if (stageAgents.length === 0) {
      lines.push("      agents: []");
    } else {
      lines.push("      agents:");
      for (const agentId of stageAgents) {
        lines.push(`        - id: ${formatYamlScalar(agentId)}`);
      }
    }

    if (stageIndex < ORCHESTRATION_BOOTSTRAP_STAGE_IDS.length - 1) {
      lines.push("");
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatYamlScalar(value: string): string {
  if (/^[a-z0-9_-]{1,32}$/u.test(value)) {
    return value;
  }
  const escaped = value.replaceAll('"', '\\"');
  return `"${escaped}"`;
}

export function listEnabledAgentIdsForOrchestrationBootstrap(
  config: AgentsConfig,
): string[] {
  return collectEnabledAgentIdsForBootstrap(config.agents);
}

export function buildDefaultOrchestrationTemplate(
  config: AgentsConfig,
): string {
  const enabledAgentIds = listEnabledAgentIdsForOrchestrationBootstrap(config);
  return serializeDefaultOrchestrationYaml(enabledAgentIds);
}
