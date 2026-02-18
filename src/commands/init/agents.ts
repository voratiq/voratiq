import {
  getAgentDefaultId,
  getSupportedAgentDefaults,
} from "../../configs/agents/defaults.js";
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
  buildDefaultAgentsTemplate,
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
  void preset;
  void options;
  const filePath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const defaultTemplate = buildDefaultAgentsTemplate();

  const loadResult = await loadYamlConfig(filePath, readAgentsConfig);
  const defaultStatus = isDefaultYamlTemplate(
    loadResult.snapshot,
    defaultTemplate,
  );
  const configCreated = !loadResult.snapshot.exists;
  const lifecycle = scanWorkspaceForAgentDefaults(
    loadResult.config,
    defaultStatus,
    getSupportedAgentDefaults(),
  );
  const detectedProviders = collectDetectedProviders(lifecycle.templates);

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
    configUpdated: updated,
  });
}

interface AgentLifecycleState {
  templates: AgentTemplateState[];
  userDefined: AgentConfigEntry[];
  zeroDetections: boolean;
}

interface AgentTemplateState {
  templateId: string;
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
  const detectedBinaryByProvider = new Map<string, string | undefined>();
  const templateEntries = templates.map((template) => ({
    template,
    templateId: getAgentDefaultId(template),
  }));

  for (const { template, templateId } of templateEntries) {
    templateIds.add(templateId);

    const existing = isDefaultTemplate
      ? undefined
      : templatesById.get(templateId);
    let detectedBinary = detectedBinaryByProvider.get(template.provider);
    if (!detectedBinaryByProvider.has(template.provider)) {
      detectedBinary = detectBinary(template.provider);
      detectedBinaryByProvider.set(template.provider, detectedBinary);
    }
    const baseEntry = existing ?? buildEntryFromTemplate(template, templateId);
    const entry = cloneAgentEntry(baseEntry);
    entry.binary = detectedBinary ?? "";
    entry.enabled = entry.enabled !== false;

    templateStates.push({
      templateId,
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
  templateId: string,
): AgentConfigEntry {
  return {
    id: templateId,
    provider: template.provider,
    model: template.model,
    enabled: true,
    binary: "",
    extraArgs:
      template.extraArgs && template.extraArgs.length > 0
        ? [...template.extraArgs]
        : undefined,
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
