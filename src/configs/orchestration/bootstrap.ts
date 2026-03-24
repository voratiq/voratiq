import {
  type AgentPreset,
  getAgentDefaultId,
  getAgentDefaultsForPreset,
} from "../agents/defaults.js";
import type { AgentConfigEntry, AgentsConfig } from "../agents/types.js";

const ORCHESTRATION_BOOTSTRAP_STAGE_IDS = [
  "spec",
  "run",
  "verify",
  "reduce",
] as const;

export interface ResolvedPresetAgent {
  readonly id: string;
  readonly runOnly?: true;
}

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
  presetAgents: readonly ResolvedPresetAgent[],
): string {
  const lines = ["profiles:", "  default:"];

  for (const stageId of ORCHESTRATION_BOOTSTRAP_STAGE_IDS) {
    lines.push(`    ${stageId}:`);

    const agents =
      stageId === "run" ? presetAgents : presetAgents.filter((a) => !a.runOnly);

    if (agents.length === 0) {
      lines.push("      agents: []");
    } else {
      lines.push("      agents:");
      for (const agent of agents) {
        lines.push(`        - id: ${formatYamlScalar(agent.id)}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatYamlScalar(value: string): string {
  if (/^[a-z0-9_-]{1,64}$/u.test(value)) {
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

export function listPresetStageAgentsForOrchestrationBootstrap(
  config: AgentsConfig,
  preset: AgentPreset,
): ResolvedPresetAgent[] {
  if (preset === "manual") {
    return [];
  }

  const enabledByProvider = groupEnabledAgentsByProvider(config.agents);
  const seenAgentIds = new Set<string>();
  const stageAgents: ResolvedPresetAgent[] = [];

  for (const agentDefault of getAgentDefaultsForPreset(preset)) {
    const candidates = enabledByProvider.get(agentDefault.provider);
    if (!candidates || candidates.length === 0) {
      continue;
    }

    const defaultId = getAgentDefaultId(agentDefault);
    const preferred = candidates.find((entry) => entry.id === defaultId);
    const selectedId = preferred?.id ?? candidates[0]?.id;
    if (!selectedId || seenAgentIds.has(selectedId)) {
      continue;
    }

    seenAgentIds.add(selectedId);
    stageAgents.push({
      id: selectedId,
      ...(agentDefault.runOnly ? { runOnly: true } : {}),
    });
  }

  return stageAgents;
}

function groupEnabledAgentsByProvider(
  agents: readonly AgentConfigEntry[],
): Map<string, AgentConfigEntry[]> {
  const grouped = new Map<string, AgentConfigEntry[]>();

  for (const entry of agents) {
    if (entry.enabled === false) {
      continue;
    }
    if (!hasBinary(entry.binary)) {
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

function hasBinary(binary: string | undefined): boolean {
  return typeof binary === "string" && binary.trim().length > 0;
}

export function buildDefaultOrchestrationTemplate(
  config: AgentsConfig,
  preset: AgentPreset = "pro",
): string {
  const stageAgents = listPresetStageAgentsForOrchestrationBootstrap(
    config,
    preset,
  );
  return serializeDefaultOrchestrationYaml(stageAgents);
}
