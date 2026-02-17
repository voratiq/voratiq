import { getAgentDefaultsForPreset } from "../../configs/agents/defaults.js";
import { readAgentsConfig } from "../../configs/agents/loader.js";
import type {
  AgentConfigEntry,
  AgentsConfig,
} from "../../configs/agents/types.js";
import { detectBinary } from "../../utils/binaries.js";
import {
  isDefaultYamlTemplate,
  loadYamlConfig,
  persistYamlConfig,
} from "../../utils/yaml.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
} from "../../workspace/structure.js";
import {
  type AgentPreset,
  buildAgentsTemplate,
  sanitizeAgentIdFromModel,
  serializeAgentsConfigEntries,
  type VendorTemplate,
} from "../../workspace/templates.js";
import type {
  AgentInitSummary,
  DetectedProviderSummary,
  InitConfigureOptions,
} from "./types.js";

export const AGENTS_CONFIG_DISPLAY_PATH =
  formatWorkspacePath(VORATIQ_AGENTS_FILE);

export async function configureAgents(
  root: string,
  preset: AgentPreset,
  options: InitConfigureOptions,
): Promise<AgentInitSummary> {
  void options;
  const filePath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const defaultTemplate = buildAgentsTemplate(preset);

  const loadResult = await loadYamlConfig(filePath, readAgentsConfig);
  const defaultStatus = isDefaultYamlTemplate(
    loadResult.snapshot,
    defaultTemplate,
  );
  const configCreated = !loadResult.snapshot.exists;
  let lifecycle: AgentLifecycleState | undefined;
  let detectedProviders: DetectedProviderSummary[];

  if (preset === "manual") {
    detectedProviders = collectSupportedProviderDetections();
    return buildAgentSummary({
      entries: loadResult.config.agents,
      zeroDetections: detectedProviders.length === 0,
      detectedProviders,
      providerEnablementPrompted: false,
      configCreated,
      configUpdated: false,
    });
  }

  lifecycle = scanWorkspaceForAgentDefaults(
    loadResult.config,
    defaultStatus,
    getAgentDefaultsForPreset(preset),
  );
  detectedProviders = collectDetectedProviders(lifecycle.templates);

  if (!defaultStatus && loadResult.snapshot.exists) {
    return buildAgentSummary({
      entries: loadResult.config.agents,
      zeroDetections: detectedProviders.length === 0,
      detectedProviders,
      providerEnablementPrompted: false,
      configCreated,
      configUpdated: false,
    });
  }

  const configChanged = applyProviderEnablementDecision(lifecycle, true);

  const snapshotResult = finalizeAgentConfigSnapshot(lifecycle);

  const updated = await persistYamlConfig({
    filePath,
    serialized: snapshotResult.serialized,
    original: loadResult.snapshot,
    defaultTemplate,
    isDefaultTemplate: defaultStatus,
  });

  return buildAgentSummary({
    entries: snapshotResult.entries,
    zeroDetections: lifecycle.zeroDetections,
    detectedProviders,
    providerEnablementPrompted: false,
    configCreated,
    configUpdated: updated || configChanged,
  });
}

interface AgentLifecycleState {
  templates: AgentTemplateState[];
  userDefined: AgentConfigEntry[];
  zeroDetections: boolean;
}

interface AgentTemplateState {
  template: VendorTemplate;
  entry: AgentConfigEntry;
  detectedBinary?: string;
}

function scanWorkspaceForAgentDefaults(
  config: AgentsConfig,
  isDefaultTemplate: boolean,
  templates: readonly VendorTemplate[],
): AgentLifecycleState {
  const templatesById = new Map<string, AgentConfigEntry>();
  for (const entry of config.agents) {
    templatesById.set(entry.id, entry);
  }

  const templateStates: AgentTemplateState[] = [];
  const templateIds = new Set<string>();
  const templateEntries = templates.map((template) => ({
    template,
    defaultId: sanitizeAgentIdFromModel(template.model),
  }));

  for (const { template, defaultId } of templateEntries) {
    templateIds.add(defaultId);

    const existing = isDefaultTemplate
      ? undefined
      : templatesById.get(defaultId);
    const detectedBinary = detectBinary(template.provider);
    const baseEntry = existing ?? buildEntryFromTemplate(template, defaultId);
    const entry = cloneAgentEntry(baseEntry);
    entry.binary = detectedBinary ?? entry.binary ?? "";
    entry.enabled = entry.enabled !== false;

    templateStates.push({
      template,
      entry,
      detectedBinary,
    });
  }

  const userDefined: AgentConfigEntry[] = [];
  for (const entry of config.agents) {
    if (!templateIds.has(entry.id)) {
      userDefined.push(cloneAgentEntry(entry));
    }
  }

  const zeroDetections = templateStates.every(
    (state) => !hasBinary(state.detectedBinary),
  );

  return {
    templates: templateStates,
    userDefined,
    zeroDetections,
  };
}

function buildEntryFromTemplate(
  template: VendorTemplate,
  defaultId: string,
): AgentConfigEntry {
  return {
    id: defaultId,
    provider: template.provider,
    model: template.model,
    enabled: false,
    binary: "",
  };
}

function cloneAgentEntry(entry: AgentConfigEntry): AgentConfigEntry {
  return {
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    enabled: entry.enabled !== false,
    binary: entry.binary ?? "",
    extraArgs:
      entry.extraArgs && entry.extraArgs.length > 0
        ? [...entry.extraArgs]
        : undefined,
  };
}

function collectDetectedProviders(
  templates: readonly AgentTemplateState[],
): DetectedProviderSummary[] {
  const rows: DetectedProviderSummary[] = [];
  const seenProviders = new Set<string>();

  for (const templateState of templates) {
    const binary = templateState.detectedBinary?.trim();
    if (!binary) {
      continue;
    }

    const provider = templateState.template.provider;
    if (seenProviders.has(provider)) {
      continue;
    }

    seenProviders.add(provider);
    rows.push({
      provider,
      binary,
    });
  }

  return rows;
}

function applyProviderEnablementDecision(
  state: AgentLifecycleState,
  enableDetectedProviders: boolean,
): boolean {
  let changed = false;

  for (const templateState of state.templates) {
    const previousEnabled = templateState.entry.enabled !== false;
    const hasDetectedBinary = hasBinary(templateState.detectedBinary);
    const nextEnabled = hasDetectedBinary ? enableDetectedProviders : false;
    if (nextEnabled !== previousEnabled) {
      changed = true;
    }
    templateState.entry.enabled = nextEnabled;
  }

  state.zeroDetections = state.templates.every(
    (templateState) => !hasBinary(templateState.detectedBinary),
  );

  return changed;
}

function buildFinalAgentEntries(
  state: AgentLifecycleState,
): AgentConfigEntry[] {
  const finalEntries = state.templates.map(
    (templateState) => templateState.entry,
  );
  return [...finalEntries, ...state.userDefined];
}

interface AgentSnapshotResult {
  entries: AgentConfigEntry[];
  serialized: string;
}

function finalizeAgentConfigSnapshot(
  state: AgentLifecycleState,
): AgentSnapshotResult {
  const entries = buildFinalAgentEntries(state);
  const serialized = serializeAgentsConfigEntries(entries);
  return { entries, serialized };
}

function buildAgentSummary(options: {
  entries: AgentConfigEntry[];
  zeroDetections: boolean;
  detectedProviders: readonly DetectedProviderSummary[];
  providerEnablementPrompted: boolean;
  configCreated: boolean;
  configUpdated: boolean;
}): AgentInitSummary {
  const {
    entries,
    zeroDetections,
    detectedProviders,
    providerEnablementPrompted,
    configCreated,
    configUpdated,
  } = options;

  const enabledAgents = entries
    .filter((entry) => entry.enabled !== false)
    .map((entry) => entry.id);

  return {
    configPath: AGENTS_CONFIG_DISPLAY_PATH,
    enabledAgents,
    agentCount: entries.length,
    zeroDetections,
    detectedProviders: [...detectedProviders],
    providerEnablementPrompted,
    configCreated,
    configUpdated,
  };
}

function hasBinary(binary: string | undefined): boolean {
  return Boolean(binary && binary.trim().length > 0);
}

function collectSupportedProviderDetections(): DetectedProviderSummary[] {
  const providers = listSupportedProviders();
  const detections: DetectedProviderSummary[] = [];

  for (const provider of providers) {
    const binary = detectBinary(provider);
    const resolvedBinary = binary?.trim();
    if (!resolvedBinary) {
      continue;
    }

    detections.push({
      provider,
      binary: resolvedBinary,
    });
  }

  return detections;
}

function listSupportedProviders(): string[] {
  const providers: string[] = [];
  const seen = new Set<string>();
  const presets: readonly AgentPreset[] = ["pro", "lite"];

  for (const preset of presets) {
    for (const agentDefault of getAgentDefaultsForPreset(preset)) {
      if (seen.has(agentDefault.provider)) {
        continue;
      }
      seen.add(agentDefault.provider);
      providers.push(agentDefault.provider);
    }
  }

  return providers;
}
