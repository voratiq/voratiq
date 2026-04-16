import { detectEnvironmentConfig } from "../../configs/environment/detect.js";
import { EnvironmentConfigParseError } from "../../configs/environment/errors.js";
import {
  readEnvironmentConfig,
  serializeEnvironmentConfig,
} from "../../configs/environment/loader.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import {
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
  isNodeEnvironmentDisabled,
  isPythonEnvironmentDisabled,
} from "../../configs/environment/types.js";
import { persistYamlConfig, readConfigSnapshot } from "../../utils/yaml.js";
import { VORATIQ_ENVIRONMENT_FILE } from "../../workspace/constants.js";
import { formatWorkspacePath } from "../../workspace/path-formatters.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import { buildDefaultEnvironmentTemplate } from "../../workspace/templates.js";
import type {
  DoctorBootstrapConfigureOptions,
  EnvironmentInitSummary,
} from "./fix-types.js";

const ENVIRONMENT_CONFIG_DISPLAY_PATH = formatWorkspacePath(
  VORATIQ_ENVIRONMENT_FILE,
);

export async function reconcileDoctorEnvironment(
  root: string,
  options: DoctorBootstrapConfigureOptions,
): Promise<EnvironmentInitSummary> {
  const filePath = resolveWorkspacePath(root, VORATIQ_ENVIRONMENT_FILE);
  const defaultTemplate = buildDefaultEnvironmentTemplate();
  const originalSnapshot = await readConfigSnapshot(filePath);
  const existingConfig = resolveExistingConfig(originalSnapshot);

  const detection = await detectEnvironmentConfig({
    root,
    interactive: options.interactive,
    promptPath: options.prompt ?? undefined,
  });

  const mergedConfig = mergeEnvironmentConfig(existingConfig, detection.config);
  const finalSerialized = resolveSerializedConfig(
    mergedConfig,
    defaultTemplate,
  );

  const configUpdated = await persistYamlConfig({
    filePath,
    serialized: finalSerialized,
    original: shouldRewriteFromScratch(originalSnapshot)
      ? { content: "", normalized: "", exists: false }
      : originalSnapshot,
    defaultTemplate,
  });

  return {
    configPath: ENVIRONMENT_CONFIG_DISPLAY_PATH,
    detectedEntries: describeEnvironmentEntries(mergedConfig),
    configCreated: !originalSnapshot.exists,
    configUpdated,
    config: mergedConfig,
  };
}

function resolveExistingConfig(
  snapshot: Awaited<ReturnType<typeof readConfigSnapshot>>,
): EnvironmentConfig {
  if (!snapshot.exists) {
    return {};
  }

  try {
    return readEnvironmentConfig(snapshot.content);
  } catch (error) {
    if (error instanceof EnvironmentConfigParseError) {
      return {};
    }
    throw error;
  }
}

function shouldRewriteFromScratch(
  snapshot: Awaited<ReturnType<typeof readConfigSnapshot>>,
): boolean {
  if (!snapshot.exists) {
    return false;
  }

  try {
    readEnvironmentConfig(snapshot.content);
    return false;
  } catch (error) {
    if (error instanceof EnvironmentConfigParseError) {
      return true;
    }
    throw error;
  }
}

function mergeEnvironmentConfig(
  existing: EnvironmentConfig,
  detected: EnvironmentConfig,
): EnvironmentConfig {
  const merged: EnvironmentConfig = { ...existing };

  if (!isNodeEnvironmentDisabled(merged)) {
    const detectedRoots = getNodeDependencyRoots(detected);
    const existingRoots = getNodeDependencyRoots(merged);
    if (detectedRoots.length > 0 && existingRoots.length === 0) {
      merged.node = {
        dependencyRoots: [...detectedRoots],
      };
    }
  }

  if (!isPythonEnvironmentDisabled(merged)) {
    const detectedPath = getPythonEnvironmentPath(detected);
    const existingPath = getPythonEnvironmentPath(merged);
    if (detectedPath && !existingPath) {
      merged.python = { path: detectedPath };
    }
  }

  return merged;
}

function resolveSerializedConfig(
  config: EnvironmentConfig,
  defaultTemplate: string,
): string {
  const serialized = serializeEnvironmentConfig(config);
  return serialized.trim().length > 0 ? serialized : defaultTemplate;
}

function describeEnvironmentEntries(config: EnvironmentConfig): string[] {
  const entries: string[] = [];
  if (isNodeEnvironmentDisabled(config)) {
    entries.push("node (disabled)");
  } else if (getNodeDependencyRoots(config).length > 0) {
    entries.push("node");
  }

  if (isPythonEnvironmentDisabled(config)) {
    entries.push("python (disabled)");
  } else {
    const pythonPath = getPythonEnvironmentPath(config);
    if (pythonPath) {
      entries.push("python");
    }
  }
  return entries;
}
