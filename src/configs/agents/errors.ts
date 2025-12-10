import { WorkspaceSetupError } from "../../workspace/errors.js";

export const DEFAULT_ERROR_CONTEXT = "Invalid `agents.yaml`" as const;

export class AgentsError extends WorkspaceSetupError {
  constructor(message: string) {
    super(message);
    this.name = "AgentsError";
  }
}

export class AgentsConfigError extends AgentsError {
  constructor(message: string) {
    super(message);
    this.name = "AgentsConfigError";
  }
}

export class MissingAgentsConfigError extends AgentsConfigError {
  constructor(public readonly filePath: string) {
    super(`Missing agent configuration file at ${filePath}.`);
    this.name = "MissingAgentsConfigError";
  }
}

export class AgentsYamlParseError extends AgentsConfigError {
  constructor(message: string) {
    super(message);
    this.name = "AgentsYamlParseError";
  }
}

export class DuplicateAgentIdError extends AgentsConfigError {
  constructor(
    public readonly agentId: string,
    public readonly displayPath: string,
  ) {
    super(
      `${DEFAULT_ERROR_CONTEXT}: Duplicate enabled agent id "${agentId}" in ${displayPath}. Agent ids must be unique.`,
    );
    this.name = "DuplicateAgentIdError";
  }
}

export class ModelPlaceholderMissingError extends AgentsError {
  constructor(
    public readonly agentId: string,
    public readonly placeholder: string,
  ) {
    super(`Expected argv for agent ${agentId} to include ${placeholder}`);
    this.name = "ModelPlaceholderMissingError";
  }
}

export class UnknownAgentProviderTemplateError extends AgentsConfigError {
  constructor(
    public readonly agentId: string,
    public readonly provider: string,
  ) {
    super(
      `${DEFAULT_ERROR_CONTEXT}: Unknown provider "${provider}" referenced by agent "${agentId}" in agents.yaml.`,
    );
    this.name = "UnknownAgentProviderTemplateError";
  }
}

export class AgentBinaryMissingError extends AgentsConfigError {
  constructor(public readonly agentId: string) {
    super(
      `${DEFAULT_ERROR_CONTEXT}: Agent "${agentId}" must provide a binary path. Update agents.yaml with the CLI location for this agent.`,
    );
    this.name = "AgentBinaryMissingError";
  }
}

export class AgentBinaryAccessError extends AgentsConfigError {
  constructor(
    public readonly agentId: string,
    public readonly binaryPath: string,
    public readonly detail: string,
  ) {
    super(
      `${DEFAULT_ERROR_CONTEXT}: Agent "${agentId}" binary "${binaryPath}" is not executable (${detail}).`,
    );
    this.name = "AgentBinaryAccessError";
  }
}
