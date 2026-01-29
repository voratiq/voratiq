import { sanitizeSlug } from "../../utils/slug.js";

export const MODEL_PLACEHOLDER = "{{MODEL}}" as const;

export interface AgentDefault {
  readonly provider: string;
  readonly model: string;
  readonly argv: readonly string[];
}

export const AGENT_PRESET_CHOICES = ["pro", "lite", "manual"] as const;
export type AgentPreset = (typeof AGENT_PRESET_CHOICES)[number];

type BuiltinAgentProvider = "claude" | "codex" | "gemini";

interface AgentProviderModel {
  readonly provider: BuiltinAgentProvider;
  readonly model: string;
}

const CLAUDE_DEFAULT_ARGV = [
  "--model",
  MODEL_PLACEHOLDER,
  "--output-format",
  "json",
  "--dangerously-skip-permissions",
  "-p",
] as const;

const CODEX_DEFAULT_ARGV = [
  "exec",
  "--model",
  MODEL_PLACEHOLDER,
  "--experimental-json",
  "--dangerously-bypass-approvals-and-sandbox",
  "-c",
  "mcp_servers={}",
] as const;

const GEMINI_DEFAULT_ARGV = [
  "--model",
  MODEL_PLACEHOLDER,
  "--output-format",
  "json",
  "--yolo",
] as const;

const DEFAULT_ARGV_BY_PROVIDER: Record<
  BuiltinAgentProvider,
  readonly string[]
> = {
  claude: CLAUDE_DEFAULT_ARGV,
  codex: CODEX_DEFAULT_ARGV,
  gemini: GEMINI_DEFAULT_ARGV,
} as const;

export function sanitizeAgentIdFromModel(model: string): string {
  const sanitized = sanitizeSlug(model);
  if (!sanitized) {
    throw new Error(
      `Unable to derive agent id from model "${model}". Provide a model slug with at least one alphanumeric character.`,
    );
  }
  return sanitized;
}

function generateAgentDefaults(
  models: readonly AgentProviderModel[],
): readonly AgentDefault[] {
  return models.map(({ provider, model }) => ({
    provider,
    model,
    argv: DEFAULT_ARGV_BY_PROVIDER[provider],
  }));
}

const PRO_AGENT_PRESET: readonly AgentProviderModel[] = [
  {
    provider: "claude",
    model: "claude-opus-4-5-20251101",
  },
  {
    provider: "codex",
    model: "gpt-5.2-codex",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
  },
] as const;

const LITE_AGENT_PRESET: readonly AgentProviderModel[] = [
  {
    provider: "claude",
    model: "claude-haiku-4-5-20251001",
  },
  {
    provider: "codex",
    model: "gpt-5.1-codex-mini",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
] as const;

export const DEFAULT_AGENT_DEFAULTS = generateAgentDefaults(PRO_AGENT_PRESET);

export const LITE_AGENT_DEFAULTS = generateAgentDefaults(LITE_AGENT_PRESET);

function buildAgentDefaultsByProvider(
  agentDefaults: readonly AgentDefault[],
): Map<string, AgentDefault> {
  const map = new Map<string, AgentDefault>();
  for (const agentDefault of agentDefaults) {
    const existing = map.get(agentDefault.provider);
    if (existing) {
      throw new Error(
        `Duplicate agent defaults for provider "${agentDefault.provider}": "${existing.model}" and "${agentDefault.model}".`,
      );
    }
    map.set(agentDefault.provider, agentDefault);
  }
  return map;
}

function buildAgentDefaultsByReference(
  agentDefaults: readonly AgentDefault[],
): Map<string, AgentDefault> {
  const map = new Map<string, AgentDefault>();
  for (const agentDefault of agentDefaults) {
    const defaultId = sanitizeAgentIdFromModel(agentDefault.model);
    const keys = [agentDefault.provider, defaultId];
    for (const key of keys) {
      const existing = map.get(key);
      if (existing && existing.provider !== agentDefault.provider) {
        throw new Error(
          `Agent default reference "${key}" is ambiguous: "${existing.provider}" and "${agentDefault.provider}".`,
        );
      }
      map.set(key, agentDefault);
    }
  }
  return map;
}

const AGENT_DEFAULTS_BY_PROVIDER = buildAgentDefaultsByProvider(
  DEFAULT_AGENT_DEFAULTS,
);

const AGENT_DEFAULTS_BY_REFERENCE = buildAgentDefaultsByReference(
  DEFAULT_AGENT_DEFAULTS,
);

export function getDefaultAgentIdByProvider(
  provider: string,
): string | undefined {
  const entry = AGENT_DEFAULTS_BY_PROVIDER.get(provider);
  return entry ? sanitizeAgentIdFromModel(entry.model) : undefined;
}

export function getAgentDefault(reference: string): AgentDefault | undefined {
  const agentDefault = AGENT_DEFAULTS_BY_REFERENCE.get(reference);
  return agentDefault ? cloneAgentDefault(agentDefault) : undefined;
}

export function getAgentDefaultsForPreset(
  preset: AgentPreset,
): readonly AgentDefault[] {
  switch (preset) {
    case "pro":
      return DEFAULT_AGENT_DEFAULTS;
    case "lite":
      return LITE_AGENT_DEFAULTS;
    case "manual":
      return [];
    default:
      return assertNever(preset);
  }
}

function cloneAgentDefault(agentDefault: AgentDefault): AgentDefault {
  return {
    provider: agentDefault.provider,
    model: agentDefault.model,
    argv: [...agentDefault.argv],
  };
}

function assertNever(_value: never): never {
  void _value;
  throw new Error("Unsupported agent preset.");
}
