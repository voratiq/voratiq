import { WorkspaceError } from "../../workspace/errors.js";

const DEFAULT_ENVIRONMENT_ERROR_CONTEXT = "Invalid `environment.yaml`";

export class EnvironmentConfigError extends WorkspaceError {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigError";
  }
}

export class MissingEnvironmentConfigError extends EnvironmentConfigError {
  constructor(public readonly filePath: string) {
    super("Missing `environment.yaml`.");
    this.name = "MissingEnvironmentConfigError";
  }
}

export class EnvironmentConfigParseError extends EnvironmentConfigError {
  constructor(
    public readonly filePath: string,
    detail?: string,
  ) {
    super(
      detail
        ? `${DEFAULT_ENVIRONMENT_ERROR_CONTEXT}: ${detail}`
        : DEFAULT_ENVIRONMENT_ERROR_CONTEXT,
    );
    this.name = "EnvironmentConfigParseError";
  }
}
