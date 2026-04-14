import { readFile } from "node:fs/promises";

import {
  getAgentDefaultId,
  getAgentDefaultsForPreset,
  getSupportedAgentDefaults,
} from "../../configs/agents/defaults.js";
import { readAgentsConfig } from "../../configs/agents/loader.js";
import type {
  AgentConfigEntry,
  AgentsConfig,
} from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import { buildDefaultOrchestrationTemplate } from "../../configs/orchestration/bootstrap.js";
import { pathExists } from "../../utils/fs.js";
import {
  normalizeConfigText,
  readConfigSnapshot,
  writeConfigIfChanged,
} from "../../utils/yaml.js";
import { updateManagedState } from "../../workspace/managed-state.js";
import { createWorkspace } from "../../workspace/setup.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_ORCHESTRATION_FILE,
  VORATIQ_SANDBOX_FILE,
} from "../../workspace/structure.js";
import {
  type AgentPreset,
  listAgentPresetTemplates,
  serializeAgentsConfigEntries,
} from "../../workspace/templates.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";
import { bootstrapDoctorAgents } from "./agents.js";
import { reconcileDoctorEnvironment } from "./environment.js";
import type {
  DoctorBootstrapInput,
  DoctorBootstrapResult,
  DoctorPromptHandler,
  OrchestrationInitSummary,
  SandboxInitSummary,
} from "./fix-types.js";

export async function executeDoctorBootstrap(
  input: DoctorBootstrapInput,
): Promise<DoctorBootstrapResult> {
  const {
    root,
    preset,
    presetProvided,
    onPresetResolved,
    assumeYes,
    interactive,
    confirm,
    prompt,
  } = input;
  const workspaceExistsBeforeInit = await pathExists(
    resolveWorkspacePath(root),
  );

  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const agentsSnapshotBeforeInit = await readConfigSnapshot(agentsConfigPath);
  const agentsConfigMissing = !agentsSnapshotBeforeInit.exists;
  const orchestrationConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ORCHESTRATION_FILE,
  );
  const orchestrationSnapshotBeforeInit = await readConfigSnapshot(
    orchestrationConfigPath,
  );
  const orchestrationConfigMissing = !orchestrationSnapshotBeforeInit.exists;

  const workspaceResult = await createWorkspace(root);
  if (workspaceExistsBeforeInit) {
    const repairedOrchestrationSummary =
      await repairExistingWorkspaceOrchestration(root, {
        orchestrationConfigMissing,
        preset,
      });
    const repairOnly = await buildRepairOnlySummaries(root, workspaceResult);
    return {
      mode: "repair",
      preset,
      workspaceResult,
      ...repairOnly,
      orchestrationSummary:
        repairedOrchestrationSummary ?? repairOnly.orchestrationSummary,
    };
  }

  const resolvedPreset = await resolveAgentPreset({
    preset,
    presetProvided,
    interactive,
    prompt,
    agentsConfigMissing,
  });
  onPresetResolved?.(resolvedPreset);
  await applyAgentPresetTemplate(root, resolvedPreset, {
    presetProvided: Boolean(presetProvided),
    agentsConfigMissing,
  });

  const agentSummary = await bootstrapDoctorAgents(root, resolvedPreset, {
    interactive,
    assumeYes,
    confirm,
  });

  const orchestrationSummary = await reconcileOrchestrationConfig(root, {
    orchestrationConfigMissing,
    preset: resolvedPreset,
  });

  const environmentSummary = await reconcileDoctorEnvironment(root, {
    interactive: false,
  });

  const sandboxSummary = buildSandboxSummary(workspaceResult);
  await refreshManagedState(root, resolvedPreset);

  return {
    mode: "bootstrap",
    preset: resolvedPreset,
    workspaceResult,
    agentSummary,
    orchestrationSummary,
    environmentSummary,
    sandboxSummary,
  };
}

async function buildRepairOnlySummaries(
  root: string,
  workspaceResult: CreateWorkspaceResult,
): Promise<
  Pick<
    DoctorBootstrapResult,
    | "agentSummary"
    | "orchestrationSummary"
    | "environmentSummary"
    | "sandboxSummary"
  >
> {
  const createdFiles = new Set(
    workspaceResult.createdFiles.map((value) => value.replace(/\\/g, "/")),
  );
  const agentsConfig = readAgentsConfig(
    await readFile(resolveWorkspacePath(root, VORATIQ_AGENTS_FILE), "utf8"),
  );
  const environmentConfig = loadEnvironmentConfig({ root, optional: true });

  return {
    agentSummary: {
      configPath: formatWorkspacePath(VORATIQ_AGENTS_FILE),
      enabledAgents: agentsConfig.agents
        .filter((entry) => entry.enabled !== false)
        .map((entry) => entry.id),
      agentCount: agentsConfig.agents.length,
      zeroDetections: agentsConfig.agents.every(
        (entry) => (entry.binary ?? "").trim().length === 0,
      ),
      detectedProviders: collectDetectedProvidersFromConfig(agentsConfig),
      providerEnablementPrompted: false,
      configCreated: createdFiles.has(formatWorkspacePath(VORATIQ_AGENTS_FILE)),
      configUpdated: false,
      managed: false,
    },
    orchestrationSummary: {
      configPath: formatWorkspacePath(VORATIQ_ORCHESTRATION_FILE),
      configCreated: createdFiles.has(
        formatWorkspacePath(VORATIQ_ORCHESTRATION_FILE),
      ),
      configUpdated: false,
    },
    environmentSummary: {
      configPath: formatWorkspacePath("environment.yaml"),
      detectedEntries: Object.keys(environmentConfig),
      configCreated: createdFiles.has(formatWorkspacePath("environment.yaml")),
      configUpdated: false,
      config: environmentConfig,
    },
    sandboxSummary: buildSandboxSummary(workspaceResult),
  };
}

async function repairExistingWorkspaceOrchestration(
  root: string,
  options: {
    orchestrationConfigMissing: boolean;
    preset: AgentPreset;
  },
): Promise<OrchestrationInitSummary | undefined> {
  if (!options.orchestrationConfigMissing) {
    return undefined;
  }

  return reconcileOrchestrationConfig(root, options);
}

async function refreshManagedState(
  root: string,
  preset: AgentPreset,
): Promise<void> {
  const [agentsContent, orchestrationContent] = await Promise.all([
    readFile(resolveWorkspacePath(root, VORATIQ_AGENTS_FILE), "utf8"),
    readFile(resolveWorkspacePath(root, VORATIQ_ORCHESTRATION_FILE), "utf8"),
  ]);

  await updateManagedState(root, {
    agentsContent,
    orchestrationContent,
    orchestrationPreset: preset,
  });
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

async function reconcileOrchestrationConfig(
  root: string,
  options: {
    orchestrationConfigMissing: boolean;
    preset: AgentPreset;
  },
): Promise<OrchestrationInitSummary> {
  const configPath = formatWorkspacePath(VORATIQ_ORCHESTRATION_FILE);
  const { orchestrationConfigMissing, preset } = options;
  if (!orchestrationConfigMissing) {
    return { configPath, configCreated: false };
  }

  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const agentsSnapshot = await readConfigSnapshot(agentsConfigPath);
  const agentsConfig = readAgentsConfig(agentsSnapshot.content);
  const nextContent = buildDefaultOrchestrationTemplate(agentsConfig, preset);

  const orchestrationConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ORCHESTRATION_FILE,
  );
  const orchestrationSnapshot = await readConfigSnapshot(
    orchestrationConfigPath,
  );
  const baseline = orchestrationSnapshot.exists
    ? orchestrationSnapshot.normalized
    : "__missing__";
  const updated = await writeConfigIfChanged(
    orchestrationConfigPath,
    nextContent,
    baseline,
  );
  await updateManagedState(root, {
    orchestrationContent: nextContent,
    orchestrationPreset: preset,
  });

  return { configPath, configCreated: true, configUpdated: updated };
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

  const managedCatalogEntries = retargetManagedCatalogEntries(config);
  if (managedCatalogEntries) {
    const serialized = serializeAgentsConfigEntries(managedCatalogEntries);
    await writeConfigIfChanged(filePath, serialized, snapshot.normalized);
    return;
  }

  const managedPreset = detectManagedAgentsPreset(config);
  if (!managedPreset) {
    return;
  }

  if (managedPreset === preset) {
    return;
  }

  const updatedEntries = retargetManagedAgentEntries(config, managedPreset);
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
  prompt?: DoctorPromptHandler;
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
  prompt: DoctorPromptHandler,
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
      prefaceLines: buildPresetPromptPreface(firstPrompt),
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

function collectDetectedProvidersFromConfig(
  config: AgentsConfig,
): { provider: string; binary: string }[] {
  const detected: { provider: string; binary: string }[] = [];
  const seenProviders = new Set<string>();

  for (const entry of config.agents) {
    const binary = entry.binary?.trim();
    if (!binary || seenProviders.has(entry.provider)) {
      continue;
    }

    seenProviders.add(entry.provider);
    detected.push({ provider: entry.provider, binary });
  }

  return detected;
}

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
  extraArgs?: string[];
}

function buildCatalogRoster(): ManagedAgentSignature[] {
  return getSupportedAgentDefaults().map((agentDefault) => ({
    id: getAgentDefaultId(agentDefault),
    provider: agentDefault.provider,
    model: agentDefault.model,
    extraArgs:
      agentDefault.extraArgs && agentDefault.extraArgs.length > 0
        ? [...agentDefault.extraArgs]
        : undefined,
  }));
}

function buildPresetRoster(preset: AgentPreset): ManagedAgentSignature[] {
  if (preset === "manual") {
    return [];
  }

  return getAgentDefaultsForPreset(preset).map((agentDefault) => ({
    id: getAgentDefaultId(agentDefault),
    provider: agentDefault.provider,
    model: agentDefault.model,
    extraArgs:
      agentDefault.extraArgs && agentDefault.extraArgs.length > 0
        ? [...agentDefault.extraArgs]
        : undefined,
  }));
}

function detectManagedAgentsPreset(
  config: AgentsConfig,
): ManagedPreset | undefined {
  const catalogSignatures = new Map<string, ManagedAgentSignature>();
  for (const signature of buildCatalogRoster()) {
    catalogSignatures.set(signature.id, signature);
  }

  const entriesById = new Map<string, AgentConfigEntry>();
  for (const entry of config.agents) {
    if (entriesById.has(entry.id)) {
      return undefined;
    }
    const catalogSignature = catalogSignatures.get(entry.id);
    if (
      catalogSignature &&
      (entry.provider !== catalogSignature.provider ||
        entry.model !== catalogSignature.model)
    ) {
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

    const rosterIds = new Set(roster.map((signature) => signature.id));
    const hasCatalogEntriesOutsideRoster = config.agents.some((entry) => {
      if (!catalogSignatures.has(entry.id)) {
        return false;
      }
      return !rosterIds.has(entry.id);
    });
    if (hasCatalogEntriesOutsideRoster) {
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

function buildPresetPromptPreface(firstPrompt: boolean): string[] {
  const lines = [
    "Which workspace preset would you like?",
    "  [1] Pro (flagship)",
    "  [2] Lite (faster/cheaper)",
    "  [3] Manual (configure yourself)",
  ];

  return firstPrompt ? ["", ...lines] : lines;
}

function retargetManagedAgentEntries(
  config: AgentsConfig,
  fromPreset: ManagedPreset,
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
  const priorById = new Map(
    priorManagedAgents.map((entry) => [entry.id, entry]),
  );

  const userDefinedAgents = config.agents.filter(
    (entry) => !fromIds.has(entry.id),
  );

  const targetRoster = buildCatalogRoster();
  const targetIds = new Set(targetRoster.map((entry) => entry.id));

  // Avoid overwriting agents that were user-defined under the previous preset.
  for (const entry of userDefinedAgents) {
    if (targetIds.has(entry.id)) {
      return undefined;
    }
  }

  const nextManagedAgents: AgentConfigEntry[] = targetRoster.map(
    (signature) => {
      const priorByIdentity = priorById.get(signature.id);
      const prior = priorByProvider.get(signature.provider);
      return {
        id: signature.id,
        provider: signature.provider,
        model: signature.model,
        enabled:
          priorByIdentity !== undefined
            ? priorByIdentity.enabled !== false
            : prior?.enabled !== false,
        binary: prior?.binary ?? "",
        extraArgs:
          prior?.id === signature.id
            ? prior.extraArgs && prior.extraArgs.length > 0
              ? [...prior.extraArgs]
              : undefined
            : signature.extraArgs && signature.extraArgs.length > 0
              ? [...signature.extraArgs]
              : undefined,
      };
    },
  );

  return [...nextManagedAgents, ...userDefinedAgents];
}

function retargetManagedCatalogEntries(
  config: AgentsConfig,
): AgentConfigEntry[] | undefined {
  const catalogRoster = buildCatalogRoster();
  const catalogById = new Map(
    catalogRoster.map((signature) => [signature.id, signature]),
  );
  const catalogIds = new Set(catalogById.keys());

  const entriesById = new Map<string, AgentConfigEntry>();
  for (const entry of config.agents) {
    if (entriesById.has(entry.id)) {
      return undefined;
    }
    entriesById.set(entry.id, entry);
  }

  for (const signature of catalogRoster) {
    const existing = entriesById.get(signature.id);
    if (
      !existing ||
      existing.provider !== signature.provider ||
      existing.model !== signature.model
    ) {
      return undefined;
    }
  }

  const managedEntries: AgentConfigEntry[] = catalogRoster.map((signature) => {
    const existing = entriesById.get(signature.id);
    const binary = existing?.binary ?? "";
    return {
      id: signature.id,
      provider: signature.provider,
      model: signature.model,
      enabled: existing?.enabled === false ? false : true,
      binary,
      extraArgs:
        existing?.extraArgs && existing.extraArgs.length > 0
          ? [...existing.extraArgs]
          : signature.extraArgs && signature.extraArgs.length > 0
            ? [...signature.extraArgs]
            : undefined,
    };
  });

  const userDefinedEntries = config.agents.filter(
    (entry) => !catalogIds.has(entry.id),
  );

  return [...managedEntries, ...userDefinedEntries];
}
