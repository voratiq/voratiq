import {
  type AgentDefault,
  DEFAULT_AGENT_DEFAULTS,
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
import { detectBinary } from "../utils/binaries.js";
export {
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
  const header = "agents:\n";
  const body = entries.map(serializeAgentEntry).join("\n\n");
  return `${header}${body}\n`;
}

function buildAgentEntryFromTemplate(
  template: VendorTemplate,
): AgentConfigEntry {
  const binary = detectBinary(template.provider) ?? "";
  return agentConfigEntrySchema.parse({
    id: sanitizeAgentIdFromModel(template.model),
    provider: template.provider,
    model: template.model,
    enabled: false,
    binary,
  });
}

export function buildDefaultAgentsTemplate(): string {
  const entries = DEFAULT_AGENT_DEFAULTS.map((template) =>
    buildAgentEntryFromTemplate(template),
  );
  return serializeAgentsConfigEntries(entries);
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
