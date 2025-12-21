import { accessSync, constants as fsConstants } from "node:fs";

import { isFileSystemError } from "../../utils/fs.js";
import { relativeToRoot } from "../../utils/path.js";
import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../utils/yaml-reader.js";
import { resolveWorkspacePath } from "../../workspace/structure.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { formatYamlErrorMessage } from "../shared/yaml-error-formatter.js";
import {
  type AgentDefault,
  getAgentDefault,
  MODEL_PLACEHOLDER,
} from "./defaults.js";
import {
  AgentBinaryAccessError,
  AgentBinaryMissingError,
  AgentDisabledError,
  AgentNotFoundError,
  AgentsYamlParseError,
  DEFAULT_ERROR_CONTEXT,
  DuplicateAgentIdError,
  MissingAgentsConfigError,
  ModelPlaceholderMissingError,
  UnknownAgentProviderTemplateError,
} from "./errors.js";
import {
  type AgentCatalog,
  type AgentConfigEntry,
  type AgentDefinition,
  type AgentsConfig,
  agentsConfigSchema,
} from "./types.js";

const AGENTS_CONFIG_FILENAME = "agents.yaml" as const;

export function readAgentsConfig(content: string): AgentsConfig {
  const parsed = parseYamlDocument(content, {
    formatError: formatAgentsYamlError,
  });
  return agentsConfigSchema.parse(parsed);
}

function formatAgentsYamlError(
  detail: YamlParseErrorDetail,
): AgentsYamlParseError {
  const message = formatYamlErrorMessage(detail, {
    context: DEFAULT_ERROR_CONTEXT,
  });
  return new AgentsYamlParseError(message);
}

export interface LoadAgentCatalogOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
}

interface LoadedAgentsConfig {
  config: AgentsConfig;
  displayPath: string;
  enabledAgents: AgentConfigEntry[];
}

const loadAgentsConfigInternal = createConfigLoader<
  LoadedAgentsConfig,
  LoadAgentCatalogOptions
>({
  resolveFilePath: (root, options) =>
    options.filePath ?? resolveWorkspacePath(root, AGENTS_CONFIG_FILENAME),
  selectReadFile: (options) => options.readFile,
  handleMissing: ({ filePath }) => {
    throw new MissingAgentsConfigError(filePath);
  },
  parse: (content, context) => {
    const config = readAgentsConfig(content);
    const enabledAgents = config.agents.filter(
      (entry) => entry.enabled !== false,
    );

    const displayPath = relativeToRoot(context.root, context.filePath);
    const seenAgentIds = new Set<string>();
    for (const entry of enabledAgents) {
      if (seenAgentIds.has(entry.id)) {
        throw new DuplicateAgentIdError(entry.id, displayPath);
      }
      seenAgentIds.add(entry.id);
    }

    return { config, displayPath, enabledAgents };
  },
});

function loadAgentsConfig(
  options: LoadAgentCatalogOptions = {},
): LoadedAgentsConfig {
  return loadAgentsConfigInternal(options);
}

export function loadAgentCatalog(
  options: LoadAgentCatalogOptions = {},
): AgentCatalog {
  const { enabledAgents } = loadAgentsConfig(options);
  const catalog = enabledAgents.map((entry) => buildAgentDefinition(entry));
  validateAgentBinaries(catalog);
  return catalog;
}

export function loadAgentById(
  id: string,
  options: LoadAgentCatalogOptions = {},
): AgentDefinition {
  const { config, enabledAgents } = loadAgentsConfig(options);
  const entry = config.agents.find((agent) => agent.id === id);
  if (!entry) {
    throw new AgentNotFoundError(
      id,
      enabledAgents.map((agent) => agent.id),
    );
  }

  if (entry.enabled === false) {
    throw new AgentDisabledError(entry.id);
  }

  const definition = buildAgentDefinition(entry);
  assertAgentBinary(definition);
  return definition;
}

function validateAgentBinaries(agents: readonly AgentDefinition[]): void {
  for (const agent of agents) {
    assertAgentBinary(agent);
  }
}

function assertAgentBinary(agent: AgentDefinition): void {
  const binaryPath = agent.binary;
  if (!binaryPath || binaryPath.trim().length === 0) {
    throw new AgentBinaryMissingError(agent.id);
  }

  try {
    accessSync(binaryPath, fsConstants.X_OK);
  } catch (error) {
    throw new AgentBinaryAccessError(
      agent.id,
      binaryPath,
      formatBinaryAccessError(error),
    );
  }
}

function formatBinaryAccessError(error: unknown): string {
  if (isFileSystemError(error) && error.code) {
    return error.code;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "unknown error";
}

function buildAgentDefinition(entry: AgentConfigEntry): AgentDefinition {
  const template = resolveTemplateForEntry(entry);
  const argv = substituteModelPlaceholder(template.argv, entry.model, entry.id);
  const extraArgs = entry.extraArgs ?? [];
  validateExtraArgs(extraArgs, entry.id);
  const finalArgv = extraArgs.length > 0 ? [...argv, ...extraArgs] : argv;

  return {
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    binary: entry.binary,
    argv: finalArgv,
  };
}

function validateExtraArgs(
  extraArgs: readonly string[],
  agentId: string,
): void {
  if (extraArgs.length === 0) {
    return;
  }

  if (extraArgs.includes(MODEL_PLACEHOLDER)) {
    throw new AgentsYamlParseError(
      `${DEFAULT_ERROR_CONTEXT}: Agent "${agentId}" extraArgs cannot include bare ${MODEL_PLACEHOLDER}.`,
    );
  }

  if (extraArgs.some((arg) => arg === "--model")) {
    throw new AgentsYamlParseError(
      `${DEFAULT_ERROR_CONTEXT}: Agent "${agentId}" extraArgs cannot override --model. Remove "--model" from extraArgs.`,
    );
  }
}

function resolveTemplateForEntry(entry: AgentConfigEntry): AgentDefault {
  const trimmedProvider = entry.provider.trim();
  const candidates = compactUnique([trimmedProvider, entry.id]);

  for (const candidate of candidates) {
    const agentDefault = getAgentDefault(candidate);
    if (agentDefault) {
      return agentDefault;
    }
  }

  const failedReference =
    trimmedProvider.length > 0 ? trimmedProvider : entry.id;
  throw new UnknownAgentProviderTemplateError(entry.id, failedReference);
}

function compactUnique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    results.push(value);
  }
  return results;
}

function substituteModelPlaceholder(
  argv: readonly string[],
  model: string,
  agentId: string,
): string[] {
  let placeholderFound = false;
  const substituted = argv.map((token) => {
    if (token.includes(MODEL_PLACEHOLDER)) {
      placeholderFound = true;
      return token.replaceAll(MODEL_PLACEHOLDER, model);
    }
    return token;
  });

  if (!placeholderFound) {
    throw new ModelPlaceholderMissingError(agentId, MODEL_PLACEHOLDER);
  }

  return substituted;
}
