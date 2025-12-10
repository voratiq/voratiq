import { readAgentsConfig } from "../../configs/agents/loader.js";
import type {
  AgentConfigEntry,
  AgentsConfig,
} from "../../configs/agents/types.js";
import { renderAgentPromptPreface } from "../../render/transcripts/init.js";
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
  buildDefaultAgentsTemplate,
  DEFAULT_AGENT_DEFAULTS,
  sanitizeAgentIdFromModel,
  serializeAgentsConfigEntries,
  type VendorTemplate,
} from "../../workspace/templates.js";
import type { AgentInitSummary, InitConfigureOptions } from "./types.js";

export const AGENTS_CONFIG_DISPLAY_PATH =
  formatWorkspacePath(VORATIQ_AGENTS_FILE);

export async function configureAgents(
  root: string,
  options: InitConfigureOptions,
): Promise<AgentInitSummary> {
  const filePath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const defaultTemplate = buildDefaultAgentsTemplate();

  const loadResult = await loadYamlConfig(filePath, readAgentsConfig);
  const defaultStatus = isDefaultYamlTemplate(
    loadResult.snapshot,
    defaultTemplate,
  );
  const configCreated = !loadResult.snapshot.exists;

  const canInteract = canConfirm(options);

  if (!canInteract || (!defaultStatus && loadResult.snapshot.exists)) {
    return buildAgentSummary(
      loadResult.config.agents,
      computeZeroDetections(loadResult.config.agents),
      configCreated,
      false,
    );
  }

  const lifecycle = scanWorkspaceForAgentDefaults(
    loadResult.config,
    defaultStatus,
  );

  const configChanged = await applyAgentOperatorChoices(lifecycle, options);

  const snapshotResult = finalizeAgentConfigSnapshot(lifecycle);

  const updated = await persistYamlConfig({
    filePath,
    serialized: snapshotResult.serialized,
    original: loadResult.snapshot,
    defaultTemplate,
    isDefaultTemplate: defaultStatus,
  });

  return buildAgentSummary(
    snapshotResult.entries,
    lifecycle.zeroDetections,
    configCreated,
    updated || configChanged,
  );
}

interface AgentLifecycleState {
  templates: AgentTemplateState[];
  userDefined: AgentConfigEntry[];
  zeroDetections: boolean;
}

interface AgentTemplateState {
  template: VendorTemplate;
  existing?: AgentConfigEntry;
  entry: AgentConfigEntry;
  detectedBinary?: string;
}

function scanWorkspaceForAgentDefaults(
  config: AgentsConfig,
  isDefaultTemplate: boolean,
): AgentLifecycleState {
  const templatesById = new Map<string, AgentConfigEntry>();
  for (const entry of config.agents) {
    templatesById.set(entry.id, entry);
  }

  const templateStates: AgentTemplateState[] = [];
  const templateIds = new Set<string>();
  const templateEntries = DEFAULT_AGENT_DEFAULTS.map((template) => ({
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
      existing,
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
    (state) => !hasBinary(state.entry.binary),
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

async function applyAgentOperatorChoices(
  state: AgentLifecycleState,
  options: InitConfigureOptions,
): Promise<boolean> {
  const confirm = options.confirm;
  if (!confirm) {
    state.zeroDetections = state.templates.every(
      (templateState) => !hasBinary(templateState.entry.binary),
    );
    return false;
  }

  let firstPrompt = true;
  let changed = false;

  for (const templateState of state.templates) {
    const hasDetectedBinary = hasBinary(templateState.entry.binary);
    if (!hasDetectedBinary) {
      templateState.entry.enabled = false;
      continue;
    }

    const initialEnabled = templateState.entry.enabled !== false;
    const defaultValue =
      templateState.existing !== undefined
        ? templateState.existing.enabled !== false
        : true;
    const prefaceLines = renderAgentPromptPreface({
      agentId: templateState.entry.id,
      binaryPath: templateState.entry.binary ?? "",
      detected: hasDetectedBinary,
      firstPrompt,
    });
    const shouldEnable = await confirm({
      message: "Enable?",
      defaultValue,
      prefaceLines,
    });
    if (shouldEnable !== initialEnabled) {
      changed = true;
    }
    templateState.entry.enabled = shouldEnable;
    firstPrompt = false;
  }

  state.zeroDetections = state.templates.every(
    (templateState) => !hasBinary(templateState.entry.binary),
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

function buildAgentSummary(
  entries: AgentConfigEntry[],
  zeroDetections: boolean,
  configCreated: boolean,
  configUpdated: boolean,
): AgentInitSummary {
  const enabledAgents = entries
    .filter((entry) => entry.enabled !== false)
    .map((entry) => entry.id);

  return {
    configPath: AGENTS_CONFIG_DISPLAY_PATH,
    enabledAgents,
    zeroDetections,
    configCreated,
    configUpdated,
  };
}

function hasBinary(binary: string | undefined): boolean {
  return Boolean(binary && binary.trim().length > 0);
}

function computeZeroDetections(entries: AgentConfigEntry[]): boolean {
  return !entries.some((entry) => hasBinary(entry.binary));
}

function canConfirm(options: InitConfigureOptions): boolean {
  return Boolean(options.confirm);
}
