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
  writeConfigIfChanged,
} from "../../utils/yaml.js";
import { VORATIQ_AGENTS_FILE } from "../../workspace/constants.js";
import {
  isManagedAgentsFingerprintMatch,
  readManagedState,
} from "../../workspace/managed-state.js";
import { formatWorkspacePath } from "../../workspace/path-formatters.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import {
  type AgentPreset,
  buildDefaultAgentsTemplate,
  serializeAgentsConfigEntries,
  type VendorTemplate,
} from "../../workspace/templates.js";
import type {
  AgentInitSummary,
  DetectedProviderSummary,
  DoctorBootstrapConfigureOptions,
} from "./fix-types.js";

export const AGENTS_CONFIG_DISPLAY_PATH =
  formatWorkspacePath(VORATIQ_AGENTS_FILE);

export async function bootstrapDoctorAgents(
  root: string,
  preset: AgentPreset,
  options: DoctorBootstrapConfigureOptions,
): Promise<AgentInitSummary> {
  void preset;
  void options;
  const defaultTemplate = buildDefaultAgentsTemplate();

  return configureAgentsWithMode(root, defaultTemplate, "bootstrap");
}

export async function reconcileManagedDoctorAgents(
  root: string,
): Promise<AgentInitSummary> {
  const defaultTemplate = buildDefaultAgentsTemplate();
  return configureAgentsWithMode(root, defaultTemplate, "reconcile");
}

async function configureAgentsWithMode(
  root: string,
  defaultTemplate: string,
  mode: "bootstrap" | "reconcile",
): Promise<AgentInitSummary> {
  const filePath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const loadResult = await loadYamlConfig(filePath, readAgentsConfig);
  const defaultStatus = isDefaultYamlTemplate(
    loadResult.snapshot,
    defaultTemplate,
  );
  const configCreated = !loadResult.snapshot.exists;
  const managedState =
    mode === "reconcile" ? await readManagedState(root) : undefined;
  const managed =
    mode === "reconcile"
      ? !loadResult.snapshot.exists ||
        isManagedAgentsFingerprintMatch(
          managedState?.configs.agents,
          loadResult.snapshot.content,
        ) ||
        defaultStatus
      : defaultStatus;

  const lifecycle = scanWorkspaceForAgentDefaults(
    loadResult.config,
    mode,
    getSupportedAgentDefaults(),
  );
  const detectedProviders = collectDetectedProviders(lifecycle.templates);

  if (!managed && loadResult.snapshot.exists) {
    return buildAgentSummary({
      entries: loadResult.config.agents,
      zeroDetections: detectedProviders.length === 0,
      detectedProviders,
      providerEnablementPrompted: false,
      configCreated,
      configUpdated: false,
      managed: false,
    });
  }

  const snapshotResult = finalizeAgentConfigSnapshot(lifecycle);
  const previousNormalized = loadResult.snapshot.exists
    ? loadResult.snapshot.normalized
    : "__missing__";
  const updated = await writeConfigIfChanged(
    filePath,
    snapshotResult.serialized,
    previousNormalized,
  );

  return buildAgentSummary({
    entries: snapshotResult.entries,
    zeroDetections: lifecycle.zeroDetections,
    detectedProviders,
    providerEnablementPrompted: false,
    configCreated,
    configUpdated: updated,
    managed: true,
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
  mode: "bootstrap" | "reconcile",
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

    const existing = templatesById.get(templateId);
    let detectedBinary = detectedBinaryByProvider.get(template.provider);
    if (!detectedBinaryByProvider.has(template.provider)) {
      detectedBinary = detectBinary(template.provider);
      detectedBinaryByProvider.set(template.provider, detectedBinary);
    }
    const baseEntry = existing ?? buildEntryFromTemplate(template, templateId);
    const entry = cloneAgentEntry(baseEntry);
    if (hasBinary(detectedBinary)) {
      entry.binary = detectedBinary ?? "";
      entry.enabled = true;
    } else if (!existing || mode === "bootstrap") {
      entry.binary = "";
      entry.enabled = false;
    }

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
  managed: boolean;
}): AgentInitSummary {
  const {
    entries,
    zeroDetections,
    detectedProviders,
    providerEnablementPrompted,
    configCreated,
    configUpdated,
    managed,
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
    managed,
  };
}

function hasBinary(binary: string | undefined): boolean {
  return Boolean(binary && binary.trim().length > 0);
}
