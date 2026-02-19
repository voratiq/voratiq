import { sanitizeSlug } from "../../utils/slug.js";

export const MODEL_PLACEHOLDER = "{{MODEL}}" as const;

export interface AgentDefault {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly extraArgs?: readonly string[];
  readonly argv: readonly string[];
}

export const AGENT_PRESET_CHOICES = ["pro", "lite", "manual"] as const;
export type AgentPreset = (typeof AGENT_PRESET_CHOICES)[number];

export type BuiltinAgentProvider = "claude" | "codex" | "gemini";

export interface AgentCatalogEntry {
  readonly provider: BuiltinAgentProvider;
  readonly model: string;
  readonly id?: string;
  readonly extraArgs?: readonly string[];
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
      `Unable to derive agent id from model "${model}". Provide a model identifier with at least one alphanumeric character.`,
    );
  }
  return sanitized;
}

export function getAgentDefaultId(agentDefault: {
  readonly id: string;
}): string {
  return agentDefault.id;
}

function resolveAgentCatalogEntryId(entry: {
  readonly id?: string;
  readonly model: string;
}): string {
  const explicit = entry.id?.trim();
  if (explicit) {
    return explicit;
  }
  return sanitizeAgentIdFromModel(entry.model);
}

function generateAgentDefaults(
  entries: readonly AgentCatalogEntry[],
): readonly AgentDefault[] {
  return entries.map(({ provider, model, id, extraArgs }) => ({
    id: resolveAgentCatalogEntryId({ id, model }),
    provider,
    model,
    extraArgs: extraArgs && extraArgs.length > 0 ? [...extraArgs] : undefined,
    argv: DEFAULT_ARGV_BY_PROVIDER[provider],
  }));
}

const DEFAULT_AGENT_CATALOG_ENTRIES: readonly AgentCatalogEntry[] = [
  {
    id: "claude-haiku-4-5-20251001",
    provider: "claude",
    model: "claude-haiku-4-5-20251001",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    provider: "claude",
    model: "claude-sonnet-4-5-20250929",
  },
  {
    id: "claude-sonnet-4-6",
    provider: "claude",
    model: "claude-sonnet-4-6",
  },
  {
    id: "claude-opus-4-5-20251101",
    provider: "claude",
    model: "claude-opus-4-5-20251101",
  },
  {
    id: "claude-opus-4-6",
    provider: "claude",
    model: "claude-opus-4-6",
  },
  {
    id: "gpt-5-codex",
    provider: "codex",
    model: "gpt-5-codex",
  },
  {
    id: "gpt-5-1-codex-mini",
    provider: "codex",
    model: "gpt-5.1-codex-mini",
  },
  {
    id: "gpt-5-1-codex",
    provider: "codex",
    model: "gpt-5.1-codex",
  },
  {
    id: "gpt-5-1-codex-max",
    provider: "codex",
    model: "gpt-5.1-codex-max",
  },
  {
    id: "gpt-5-1-codex-max-xhigh",
    provider: "codex",
    model: "gpt-5.1-codex-max",
    extraArgs: ["--config", "model_reasoning_effort=xhigh"],
  },
  {
    id: "gpt-5-2",
    provider: "codex",
    model: "gpt-5.2",
  },
  {
    id: "gpt-5-2-high",
    provider: "codex",
    model: "gpt-5.2",
    extraArgs: ["--config", "model_reasoning_effort=high"],
  },
  {
    id: "gpt-5-2-xhigh",
    provider: "codex",
    model: "gpt-5.2",
    extraArgs: ["--config", "model_reasoning_effort=xhigh"],
  },
  {
    id: "gpt-5-2-codex",
    provider: "codex",
    model: "gpt-5.2-codex",
  },
  {
    id: "gpt-5-2-codex-high",
    provider: "codex",
    model: "gpt-5.2-codex",
    extraArgs: ["--config", "model_reasoning_effort=high"],
  },
  {
    id: "gpt-5-2-codex-xhigh",
    provider: "codex",
    model: "gpt-5.2-codex",
    extraArgs: ["--config", "model_reasoning_effort=xhigh"],
  },
  {
    id: "gpt-5-3-codex-spark",
    provider: "codex",
    model: "gpt-5.3-codex-spark",
  },
  {
    id: "gpt-5-3-codex",
    provider: "codex",
    model: "gpt-5.3-codex",
  },
  {
    id: "gpt-5-3-codex-high",
    provider: "codex",
    model: "gpt-5.3-codex",
    extraArgs: ["--config", "model_reasoning_effort=high"],
  },
  {
    id: "gpt-5-3-codex-xhigh",
    provider: "codex",
    model: "gpt-5.3-codex",
    extraArgs: ["--config", "model_reasoning_effort=xhigh"],
  },
  {
    id: "gemini-2-5-flash",
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
  {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    model: "gemini-3-flash-preview",
  },
  {
    id: "gemini-2-5-pro",
    provider: "gemini",
    model: "gemini-2.5-pro",
  },
  {
    id: "gemini-3-pro-preview",
    provider: "gemini",
    model: "gemini-3-pro-preview",
  },
] as const;

const PRO_AGENT_PRESET_ENTRIES: readonly AgentCatalogEntry[] = [
  {
    id: "claude-opus-4-6",
    provider: "claude",
    model: "claude-opus-4-6",
  },
  {
    id: "gpt-5-3-codex",
    provider: "codex",
    model: "gpt-5.3-codex",
  },
  {
    id: "gemini-2-5-pro",
    provider: "gemini",
    model: "gemini-2.5-pro",
  },
] as const;

const LITE_AGENT_PRESET_ENTRIES: readonly AgentCatalogEntry[] = [
  {
    id: "claude-haiku-4-5-20251001",
    provider: "claude",
    model: "claude-haiku-4-5-20251001",
  },
  {
    id: "gpt-5-1-codex-mini",
    provider: "codex",
    model: "gpt-5.1-codex-mini",
  },
  {
    id: "gemini-2-5-flash",
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
] as const;

export const PRO_AGENT_DEFAULTS = generateAgentDefaults(
  PRO_AGENT_PRESET_ENTRIES,
);

export const LITE_AGENT_DEFAULTS = generateAgentDefaults(
  LITE_AGENT_PRESET_ENTRIES,
);

export const BUILTIN_AGENT_DEFAULTS = generateAgentDefaults(
  DEFAULT_AGENT_CATALOG_ENTRIES,
);

interface AgentCatalogGuardrailInput {
  readonly builtinCatalog: readonly AgentCatalogEntry[];
  readonly presetCatalogs: readonly {
    readonly presetName: Exclude<AgentPreset, "manual">;
    readonly catalog: readonly AgentCatalogEntry[];
  }[];
}

export function assertAgentCatalogGuardrails(
  input: AgentCatalogGuardrailInput,
): void {
  const supportedDefaults = generateAgentDefaults(input.builtinCatalog);
  const byId = new Map<string, AgentDefault>();

  for (const agentDefault of supportedDefaults) {
    const existing = byId.get(agentDefault.id);
    if (existing) {
      throw new Error(
        `SUPPORTED_AGENT_CATALOG contains duplicate agent id "${agentDefault.id}" for "${existing.model}" and "${agentDefault.model}".`,
      );
    }
    byId.set(agentDefault.id, agentDefault);
  }

  for (const { presetName, catalog } of input.presetCatalogs) {
    const presetDefaults = generateAgentDefaults(catalog);
    const seenPresetIds = new Set<string>();

    for (const presetDefault of presetDefaults) {
      if (seenPresetIds.has(presetDefault.id)) {
        throw new Error(
          `${presetName.toUpperCase()}_AGENT_PRESET contains duplicate agent id "${presetDefault.id}".`,
        );
      }
      seenPresetIds.add(presetDefault.id);

      const supported = byId.get(presetDefault.id);
      if (!supported) {
        throw new Error(
          `${presetName.toUpperCase()}_AGENT_PRESET entry "${presetDefault.id}" is not present in SUPPORTED_AGENT_CATALOG.`,
        );
      }

      if (
        supported.provider !== presetDefault.provider ||
        supported.model !== presetDefault.model ||
        !stringListsEqual(supported.extraArgs, presetDefault.extraArgs)
      ) {
        throw new Error(
          `${presetName.toUpperCase()}_AGENT_PRESET entry "${presetDefault.id}" must exactly match SUPPORTED_AGENT_CATALOG (provider/model/extraArgs).`,
        );
      }
    }
  }
}

function stringListsEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftList = left ?? [];
  const rightList = right ?? [];
  if (leftList.length !== rightList.length) {
    return false;
  }
  for (const [index, value] of leftList.entries()) {
    if (value !== rightList[index]) {
      return false;
    }
  }
  return true;
}

assertAgentCatalogGuardrails({
  builtinCatalog: DEFAULT_AGENT_CATALOG_ENTRIES,
  presetCatalogs: [
    { presetName: "pro", catalog: PRO_AGENT_PRESET_ENTRIES },
    { presetName: "lite", catalog: LITE_AGENT_PRESET_ENTRIES },
  ],
});

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
    const keys = [agentDefault.provider, agentDefault.id];
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

const AGENT_DEFAULTS_BY_PROVIDER =
  buildAgentDefaultsByProvider(PRO_AGENT_DEFAULTS);

const AGENT_DEFAULTS_BY_REFERENCE =
  buildAgentDefaultsByReference(PRO_AGENT_DEFAULTS);

export function getDefaultAgentIdByProvider(
  provider: string,
): string | undefined {
  const entry = AGENT_DEFAULTS_BY_PROVIDER.get(provider);
  return entry ? entry.id : undefined;
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
      return PRO_AGENT_DEFAULTS;
    case "lite":
      return LITE_AGENT_DEFAULTS;
    case "manual":
      return [];
    default:
      return assertNever(preset);
  }
}

export function getSupportedAgentDefaults(): readonly AgentDefault[] {
  return BUILTIN_AGENT_DEFAULTS;
}

function cloneAgentDefault(agentDefault: AgentDefault): AgentDefault {
  return {
    id: agentDefault.id,
    provider: agentDefault.provider,
    model: agentDefault.model,
    extraArgs:
      agentDefault.extraArgs && agentDefault.extraArgs.length > 0
        ? [...agentDefault.extraArgs]
        : undefined,
    argv: [...agentDefault.argv],
  };
}

function assertNever(_value: never): never {
  void _value;
  throw new Error("Unsupported agent preset.");
}
