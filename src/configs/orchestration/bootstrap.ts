import {
  type AgentPreset,
  getAgentDefaultsForPreset,
  sanitizeAgentIdFromModel,
} from "../agents/defaults.js";
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
  runStageAgentIds: readonly string[],
): string {
  const lines = ["profiles:", "  default:"];

  for (const [
    stageIndex,
    stageId,
  ] of ORCHESTRATION_BOOTSTRAP_STAGE_IDS.entries()) {
    lines.push(`    ${stageId}:`);

    const usePresetAgents = stageId === "run";
    const agents = usePresetAgents ? runStageAgentIds : [];

    if (agents.length === 0) {
      lines.push("      agents: []");
    } else {
      lines.push("      agents:");
      for (const agentId of agents) {
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

export function listPresetStageAgentIdsForOrchestrationBootstrap(
  config: AgentsConfig,
  preset: AgentPreset,
): string[] {
  if (preset === "manual") {
    return [];
  }

  const enabledByProvider = groupEnabledAgentsByProvider(config.agents);
  const seenAgentIds = new Set<string>();
  const stageAgentIds: string[] = [];

  for (const agentDefault of getAgentDefaultsForPreset(preset)) {
    const candidates = enabledByProvider.get(agentDefault.provider);
    if (!candidates || candidates.length === 0) {
      continue;
    }

    const defaultId = sanitizeAgentIdFromModel(agentDefault.model);
    const preferred = candidates.find((entry) => entry.id === defaultId);
    const selectedId = preferred?.id ?? candidates[0]?.id;
    if (!selectedId || seenAgentIds.has(selectedId)) {
      continue;
    }

    seenAgentIds.add(selectedId);
    stageAgentIds.push(selectedId);
  }

  return stageAgentIds;
}

function groupEnabledAgentsByProvider(
  agents: readonly AgentConfigEntry[],
): Map<string, AgentConfigEntry[]> {
  const grouped = new Map<string, AgentConfigEntry[]>();

  for (const entry of agents) {
    if (entry.enabled === false) {
      continue;
    }

    const existing = grouped.get(entry.provider);
    if (existing) {
      existing.push(entry);
      continue;
    }

    grouped.set(entry.provider, [entry]);
  }

  return grouped;
}

export function buildDefaultOrchestrationTemplate(
  config: AgentsConfig,
  preset: AgentPreset = "pro",
): string {
  const stageAgentIds = listPresetStageAgentIdsForOrchestrationBootstrap(
    config,
    preset,
  );
  return serializeDefaultOrchestrationYaml(stageAgentIds);
}
