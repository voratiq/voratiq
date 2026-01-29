import {
  AGENT_PRESET_CHOICES,
  type AgentDefault,
  type AgentPreset,
  getAgentDefaultsForPreset,
  sanitizeAgentIdFromModel,
} from "../configs/agents/defaults.js";
import {
  type AgentConfigEntry,
  agentConfigEntrySchema,
} from "../configs/agents/types.js";
import {
  listEvalDefaults,
  serializeEvalDefaults,
} from "../configs/evals/defaults.js";
import { listSandboxProviderDefaults } from "../configs/sandbox/defaults.js";
export type { AgentPreset } from "../configs/agents/defaults.js";
export {
  AGENT_PRESET_CHOICES,
  DEFAULT_AGENT_DEFAULTS,
  MODEL_PLACEHOLDER,
  sanitizeAgentIdFromModel,
} from "../configs/agents/defaults.js";

export type VendorTemplate = AgentDefault;

function formatScalar(value: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(value)) {
    return value;
  }
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function serializeAgentEntry(entry: AgentConfigEntry): string {
  const enabled = entry.enabled !== false;
  const binary = entry.binary ?? "";
  const extraArgs = entry.extraArgs ?? [];
  const lines = [
    `  - id: ${entry.id}`,
    `    provider: ${formatScalar(entry.provider)}`,
    `    model: ${formatScalar(entry.model)}`,
    `    enabled: ${enabled ? "true" : "false"}`,
    `    binary: ${formatScalar(binary)}`,
  ];

  if (extraArgs.length > 0) {
    lines.push("    extraArgs:");
    for (const arg of extraArgs) {
      lines.push(`      - ${formatScalar(arg)}`);
    }
  }

  return lines.join("\n");
}

export function serializeAgentsConfigEntries(
  entries: ReadonlyArray<AgentConfigEntry>,
): string {
  if (entries.length === 0) {
    return "agents: []\n";
  }

  const header = "agents:\n";
  const body = entries.map(serializeAgentEntry).join("\n\n");
  return `${header}${body}\n`;
}

function buildAgentEntryFromTemplate(
  template: VendorTemplate,
): AgentConfigEntry {
  return agentConfigEntrySchema.parse({
    id: sanitizeAgentIdFromModel(template.model),
    provider: template.provider,
    model: template.model,
    enabled: false,
    binary: "",
  });
}

export function buildDefaultAgentsTemplate(): string {
  return buildAgentsTemplate("pro");
}

export function buildAgentsTemplate(preset: AgentPreset): string {
  const templates = getAgentDefaultsForPreset(preset);
  const entries = templates.map((template) =>
    buildAgentEntryFromTemplate(template),
  );
  return serializeAgentsConfigEntries(entries);
}

export interface AgentPresetTemplateDescriptor {
  preset: AgentPreset;
  template: string;
}

export function listAgentPresetTemplates(): AgentPresetTemplateDescriptor[] {
  return AGENT_PRESET_CHOICES.map((preset) => ({
    preset,
    template: buildAgentsTemplate(preset),
  }));
}

export function buildDefaultEvalsTemplate(): string {
  const lines = serializeEvalDefaults(listEvalDefaults());
  return `${lines.join("\n")}\n`;
}

export function buildDefaultEnvironmentTemplate(): string {
  return "";
}

export function buildDefaultSandboxTemplate(): string {
  const lines: string[] = ["providers:"];

  for (const provider of listSandboxProviderDefaults()) {
    lines.push(`  ${provider.id}: {}`);
  }

  lines.push("");
  return lines.join("\n");
}
