import { WorkspaceSetupError } from "../../workspace/errors.js";

const DEFAULT_EVALS_ERROR_CONTEXT = "Invalid evals.yaml" as const;

export { DEFAULT_EVALS_ERROR_CONTEXT };

export class EvalsError extends WorkspaceSetupError {
  constructor(message: string) {
    super(message);
    this.name = "EvalsError";
  }
}

export class EvalsConfigError extends EvalsError {
  constructor(message: string) {
    super(message);
    this.name = "EvalsConfigError";
  }
}

export class MissingEvalsConfigError extends EvalsConfigError {
  constructor(public readonly filePath: string) {
    super(`Missing eval configuration file at ${filePath}.`);
    this.name = "MissingEvalsConfigError";
  }
}

export class EvalsYamlParseError extends EvalsConfigError {
  constructor(message: string) {
    super(message);
    this.name = "EvalsYamlParseError";
  }
}
