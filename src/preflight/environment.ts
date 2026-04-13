import {
  EnvironmentConfigParseError,
  MissingEnvironmentConfigError,
} from "../configs/environment/errors.js";
import {
  DEFAULT_ENVIRONMENT_FILE_DISPLAY,
  loadEnvironmentConfig,
} from "../configs/environment/loader.js";
import type { EnvironmentConfig } from "../configs/environment/types.js";
import { WorkspaceMissingEntryError } from "../workspace/errors.js";

export interface LoadOperatorEnvironmentOptions {
  readonly root: string;
  readonly errorMode?: "raw" | "workspace-missing";
}

export function loadOperatorEnvironment(
  options: LoadOperatorEnvironmentOptions,
): EnvironmentConfig {
  const { root, errorMode = "raw" } = options;

  try {
    return loadEnvironmentConfig({ root });
  } catch (error) {
    if (
      errorMode === "workspace-missing" &&
      (error instanceof MissingEnvironmentConfigError ||
        error instanceof EnvironmentConfigParseError)
    ) {
      throw new WorkspaceMissingEntryError(DEFAULT_ENVIRONMENT_FILE_DISPLAY);
    }
    throw error;
  }
}
