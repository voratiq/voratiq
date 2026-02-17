import { WorkspaceSetupError } from "../../workspace/errors.js";

export const DEFAULT_ORCHESTRATION_ERROR_CONTEXT =
  "Invalid `orchestration.yaml`" as const;

export class OrchestrationConfigError extends WorkspaceSetupError {
  constructor(message: string) {
    super(message);
    this.name = "OrchestrationConfigError";
  }
}

export class MissingOrchestrationConfigError extends OrchestrationConfigError {
  constructor(public readonly filePath: string) {
    super(`Missing orchestration configuration file at ${filePath}.`);
    this.name = "MissingOrchestrationConfigError";
  }
}

export class OrchestrationYamlParseError extends OrchestrationConfigError {
  constructor(message: string) {
    super(message);
    this.name = "OrchestrationYamlParseError";
  }
}

export class OrchestrationSchemaValidationError extends OrchestrationConfigError {
  constructor(message: string) {
    super(message);
    this.name = "OrchestrationSchemaValidationError";
  }
}
