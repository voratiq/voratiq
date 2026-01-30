import { readAgentsConfig } from "../../configs/agents/loader.js";
import type {
  AgentConfigEntry,
  AgentsConfig,
} from "../../configs/agents/types.js";
import { renderPresetPromptPreface } from "../../render/transcripts/init.js";
import {
  normalizeConfigText,
  readConfigSnapshot,
  writeConfigIfChanged,
} from "../../utils/yaml.js";
import { createWorkspace } from "../../workspace/setup.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_SANDBOX_FILE,
} from "../../workspace/structure.js";
import {
  type AgentPreset,
  buildAgentsTemplate,
  listAgentPresetTemplates,
  serializeAgentsConfigEntries,
} from "../../workspace/templates.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";
import { configureAgents } from "./agents.js";
import { configureEnvironment } from "./environment.js";
import { configureEvals } from "./evals.js";
import type {
  InitCommandInput,
  InitCommandResult,
  InitPromptHandler,
  SandboxInitSummary,
} from "./types.js";

export async function executeInitCommand(
  input: InitCommandInput,
): Promise<InitCommandResult> {
  const { root, preset, presetProvided, interactive, confirm, prompt } = input;

  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const agentsSnapshotBeforeInit = await readConfigSnapshot(agentsConfigPath);
  const agentsConfigMissing = !agentsSnapshotBeforeInit.exists;

  const resolvedPreset = await resolveAgentPreset({
    preset,
    presetProvided,
    interactive,
    prompt,
    agentsConfigMissing,
  });

  const workspaceResult = await createWorkspace(root);
  await applyAgentPresetTemplate(root, resolvedPreset, {
    presetProvided: Boolean(presetProvided),
    agentsConfigMissing,
  });

  const agentSummary = await configureAgents(root, resolvedPreset, {
    interactive,
    confirm,
  });

  const environmentSummary = await configureEnvironment(root, {
    interactive,
    confirm,
    prompt,
  });

  const evalSummary = await configureEvals(
    root,
    {
      interactive,
      confirm,
    },
    environmentSummary.config,
  );

  const sandboxSummary = buildSandboxSummary(workspaceResult);

  return {
    workspaceResult,
    agentSummary,
    environmentSummary,
    evalSummary,
    sandboxSummary,
  };
}

function buildSandboxSummary(
  workspaceResult: CreateWorkspaceResult,
): SandboxInitSummary {
  const configPath = formatWorkspacePath(VORATIQ_SANDBOX_FILE);
  const normalizedCreated = workspaceResult.createdFiles.map((file) =>
    file.replace(/\\/g, "/"),
  );
  const configCreated = normalizedCreated.includes(configPath);
  return { configPath, configCreated };
}

async function applyAgentPresetTemplate(
  root: string,
  preset: AgentPreset,
  options: { presetProvided: boolean; agentsConfigMissing: boolean },
): Promise<void> {
  const { presetProvided, agentsConfigMissing } = options;

  // Only switch managed presets when the operator explicitly requests it.
  // The exception is the first run where the config is missing.
  if (!agentsConfigMissing && !presetProvided) {
    return;
  }

  const filePath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const snapshot = await readConfigSnapshot(filePath);
  const knownTemplates = listAgentPresetTemplates();
  const knownNormalized = new Set(
    knownTemplates.map((descriptor) =>
      normalizeConfigText(descriptor.template),
    ),
  );

  const selected = knownTemplates.find(
    (descriptor) => descriptor.preset === preset,
  );
  if (!selected) {
    return;
  }

  const shouldConsiderApplying =
    !snapshot.exists || knownNormalized.has(snapshot.normalized);

  if (shouldConsiderApplying) {
    const baseline = snapshot.exists ? snapshot.normalized : "__missing__";
    await writeConfigIfChanged(filePath, selected.template, baseline);
    return;
  }

  if (!presetProvided) {
    return;
  }

  // Fall back to semantic "managed" detection: allow switching between presets
  // without requiring a byte-for-byte match on the template (binary / enabled
  // often diverge after initialization).
  const config = tryReadAgentsConfig(snapshot.content);
  if (!config) {
    return;
  }

  const managedPreset = detectManagedAgentsPreset(config);
  if (!managedPreset) {
    return;
  }

  if (managedPreset === preset) {
    return;
  }

  const updatedEntries = retargetManagedAgentEntries(
    config,
    managedPreset,
    preset,
  );
  if (!updatedEntries) {
    return;
  }

  const serialized = serializeAgentsConfigEntries(updatedEntries);
  await writeConfigIfChanged(filePath, serialized, snapshot.normalized);
}

async function resolveAgentPreset(options: {
  preset: AgentPreset;
  presetProvided?: boolean;
  interactive: boolean;
  prompt?: InitPromptHandler;
  agentsConfigMissing: boolean;
}): Promise<AgentPreset> {
  const {
    preset,
    presetProvided = false,
    interactive,
    prompt,
    agentsConfigMissing,
  } = options;

  if (presetProvided) {
    return preset;
  }

  if (!interactive || !prompt) {
    return preset;
  }

  if (!agentsConfigMissing) {
    return preset;
  }

  return promptForPresetSelection(prompt);
}

async function promptForPresetSelection(
  prompt: InitPromptHandler,
): Promise<AgentPreset> {
  const choices: Record<string, AgentPreset> = {
    "1": "pro",
    "2": "lite",
    "3": "manual",
  };

  let firstPrompt = true;

  for (;;) {
    const response = await prompt({
      message: "[1]",
      prefaceLines: renderPresetPromptPreface(firstPrompt),
    });
    const trimmed = response.trim();
    const normalized = trimmed.length === 0 ? "1" : trimmed;
    const selected = choices[normalized];
    if (selected) {
      return selected;
    }

    process.stdout.write("Please choose 1, 2, or 3.\n");
    firstPrompt = false;
  }
}

type ManagedPreset = "pro" | "lite";

function tryReadAgentsConfig(content: string): AgentsConfig | undefined {
  try {
    return readAgentsConfig(content);
  } catch {
    return undefined;
  }
}

interface ManagedAgentSignature {
  id: string;
  provider: string;
  model: string;
}

function buildPresetRoster(preset: AgentPreset): ManagedAgentSignature[] {
  const template = buildAgentsTemplate(preset);
  const parsed = readAgentsConfig(template);
  return parsed.agents.map((entry) => ({
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
  }));
}

function detectManagedAgentsPreset(
  config: AgentsConfig,
): ManagedPreset | undefined {
  const entriesById = new Map<string, AgentConfigEntry>();
  for (const entry of config.agents) {
    if (entriesById.has(entry.id)) {
      return undefined;
    }
    entriesById.set(entry.id, entry);
  }

  const candidates: readonly ManagedPreset[] = ["pro", "lite"];
  for (const preset of candidates) {
    const roster = buildPresetRoster(preset);
    if (roster.length === 0) {
      continue;
    }

    let matches = true;
    for (const signature of roster) {
      const existing = entriesById.get(signature.id);
      if (
        !existing ||
        existing.provider !== signature.provider ||
        existing.model !== signature.model
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return preset;
    }
  }

  return undefined;
}

function retargetManagedAgentEntries(
  config: AgentsConfig,
  fromPreset: ManagedPreset,
  toPreset: AgentPreset,
): AgentConfigEntry[] | undefined {
  const fromRoster = buildPresetRoster(fromPreset);
  const fromIds = new Set(fromRoster.map((entry) => entry.id));

  const priorManagedAgents = config.agents.filter((entry) =>
    fromIds.has(entry.id),
  );
  const priorByProvider = new Map<string, AgentConfigEntry>();
  for (const entry of priorManagedAgents) {
    if (!priorByProvider.has(entry.provider)) {
      priorByProvider.set(entry.provider, entry);
    }
  }

  const userDefinedAgents = config.agents.filter(
    (entry) => !fromIds.has(entry.id),
  );

  const targetRoster = buildPresetRoster(toPreset);
  const targetIds = new Set(targetRoster.map((entry) => entry.id));

  // Avoid overwriting agents that were user-defined under the previous preset.
  for (const entry of userDefinedAgents) {
    if (targetIds.has(entry.id)) {
      return undefined;
    }
  }

  const nextManagedAgents: AgentConfigEntry[] = targetRoster.map(
    (signature) => {
      const prior = priorByProvider.get(signature.provider);
      return {
        id: signature.id,
        provider: signature.provider,
        model: signature.model,
        enabled: prior ? prior.enabled !== false : false,
        binary: prior?.binary ?? "",
        extraArgs:
          prior?.extraArgs && prior.extraArgs.length > 0
            ? [...prior.extraArgs]
            : undefined,
      };
    },
  );

  return [...nextManagedAgents, ...userDefinedAgents];
}
