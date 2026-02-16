import { type ZodIssue } from "zod";

import { readAgentsConfig } from "../../configs/agents/loader.js";
import { isMissing, readUtf8File } from "../../utils/fs.js";
import { relativeToRoot } from "../../utils/path.js";
import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../utils/yaml-reader.js";
import {
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_ORCHESTRATION_FILE,
} from "../../workspace/structure.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import {
  DEFAULT_ORCHESTRATION_ERROR_CONTEXT,
  MissingOrchestrationConfigError,
  OrchestrationSchemaValidationError,
  OrchestrationYamlParseError,
} from "./errors.js";
import {
  ORCHESTRATION_STAGE_IDS,
  type OrchestrationConfig,
  orchestrationConfigSchema,
} from "./types.js";

export interface LoadOrchestrationConfigOptions {
  root?: string;
  filePath?: string;
  agentsFilePath?: string;
  readFile?: (path: string) => string;
}

const loadOrchestrationConfigInternal = createConfigLoader<
  OrchestrationConfig,
  LoadOrchestrationConfigOptions
>({
  resolveFilePath: (root, options) =>
    options.filePath ?? resolveWorkspacePath(root, VORATIQ_ORCHESTRATION_FILE),
  selectReadFile: (options) => options.readFile,
  handleMissing: ({ filePath }) => {
    throw new MissingOrchestrationConfigError(filePath);
  },
  parse: (content, context) => {
    const config = readOrchestrationConfig(content);
    validateStageAgentReferences(config, {
      root: context.root,
      agentsFilePath: context.options.agentsFilePath,
      readFile: context.options.readFile,
    });
    return config;
  },
});

export function loadOrchestrationConfig(
  options: LoadOrchestrationConfigOptions = {},
): OrchestrationConfig {
  return loadOrchestrationConfigInternal(options);
}

export function readOrchestrationConfig(content: string): OrchestrationConfig {
  const parsed = parseYamlDocument(content, {
    formatError: (detail) => formatOrchestrationYamlError(detail),
  });

  const result = orchestrationConfigSchema.safeParse(parsed);
  if (!result.success) {
    const message = formatSchemaValidationErrorMessage(result.error.issues);
    throw new OrchestrationSchemaValidationError(message);
  }

  return result.data;
}

interface StageAgentValidationContext {
  root: string;
  agentsFilePath?: string;
  readFile?: (path: string) => string;
}

function validateStageAgentReferences(
  config: OrchestrationConfig,
  context: StageAgentValidationContext,
): void {
  const agentsById = loadAgentsById(context);

  for (const stageId of ORCHESTRATION_STAGE_IDS) {
    const stage = config.profiles.default[stageId];
    for (const stageAgent of stage.agents) {
      const matchingAgent = agentsById.get(stageAgent.id);

      if (!matchingAgent) {
        throw new OrchestrationSchemaValidationError(
          `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: agent ${formatAgentId(stageAgent.id)} is not defined in .voratiq/agents.yaml.`,
        );
      }

      if (matchingAgent.enabled === false) {
        throw new OrchestrationSchemaValidationError(
          `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: agent ${formatAgentId(stageAgent.id)} is disabled in .voratiq/agents.yaml.`,
        );
      }
    }
  }
}

function loadAgentsById(
  context: StageAgentValidationContext,
): Map<string, { enabled: boolean }> {
  const { root, readFile } = context;
  const agentsFilePath =
    context.agentsFilePath ?? resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const read = readFile ?? defaultReadFile;
  const agentsDisplayPath = relativeToRoot(root, agentsFilePath);

  let content: string;
  try {
    content = read(agentsFilePath);
  } catch (error) {
    if (isMissing(error)) {
      throw new OrchestrationSchemaValidationError(
        `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: cannot validate stage agents because ${agentsDisplayPath} is missing.`,
      );
    }
    throw error;
  }

  let agentsConfig;
  try {
    agentsConfig = readAgentsConfig(content);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? normalizeMessage(error.message)
        : "unknown error";
    throw new OrchestrationSchemaValidationError(
      `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: cannot validate stage agents because ${agentsDisplayPath} is invalid (${message}).`,
    );
  }

  const agentsById = new Map<string, { enabled: boolean }>();
  for (const [index, agent] of agentsConfig.agents.entries()) {
    if (agentsById.has(agent.id)) {
      throw new OrchestrationSchemaValidationError(
        `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: cannot validate stage agents because ${agentsDisplayPath} has duplicate id ${formatAgentId(agent.id)} at agents[${index}].`,
      );
    }

    agentsById.set(agent.id, { enabled: agent.enabled !== false });
  }

  return agentsById;
}

function defaultReadFile(path: string): string {
  return readUtf8File(path, "utf8");
}

function formatOrchestrationYamlError(
  detail: YamlParseErrorDetail,
): OrchestrationYamlParseError {
  const parseReason = normalizeMessage(
    detail.reason ??
      detail.message ??
      `${VORATIQ_ORCHESTRATION_FILE} contains invalid YAML`,
  );
  return new OrchestrationYamlParseError(
    `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: ${parseReason}.`,
  );
}

function formatSchemaValidationErrorMessage(
  issues: readonly ZodIssue[],
): string {
  const issue = selectMostActionableIssue(issues);
  if (!issue) {
    return `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: invalid value.`;
  }

  const path = formatIssuePath(issue.path);

  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys
      .slice()
      .sort()
      .map((key) => `"${key}"`)
      .join(", ");
    const noun = issue.keys.length > 1 ? "keys" : "key";
    return `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: ${path}: unknown ${noun} ${keys}.`;
  }

  return `${DEFAULT_ORCHESTRATION_ERROR_CONTEXT}: ${path}: ${normalizeMessage(issue.message)}.`;
}

function selectMostActionableIssue(
  issues: readonly ZodIssue[],
): ZodIssue | undefined {
  const unrecognizedKeyIssue = issues.find(
    (issue) => issue.code === "unrecognized_keys",
  );
  return unrecognizedKeyIssue ?? issues[0];
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
      continue;
    }

    if (typeof segment === "symbol") {
      const symbolLabel = segment.description ?? segment.toString();
      formatted =
        formatted.length === 0 ? symbolLabel : `${formatted}.${symbolLabel}`;
      continue;
    }

    formatted = formatted.length === 0 ? segment : `${formatted}.${segment}`;
  }

  return formatted;
}

function normalizeMessage(message: string): string {
  const compact = message.replace(/\s+/gu, " ").trim();
  return compact.replace(/[.]$/u, "");
}

function formatAgentId(agentId: string): string {
  return `\`${agentId}\``;
}
