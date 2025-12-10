import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../utils/yaml-reader.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_ENVIRONMENT_FILE,
} from "../../workspace/structure.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { formatYamlErrorDetail } from "../shared/yaml-error-formatter.js";
import {
  EnvironmentConfigParseError,
  MissingEnvironmentConfigError,
} from "./errors.js";
import {
  type EnvironmentConfig,
  environmentConfigSchema,
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
  isNodeEnvironmentDisabled,
  isPythonEnvironmentDisabled,
  normalizeEnvironmentConfig,
} from "./types.js";

export const DEFAULT_ENVIRONMENT_FILE_DISPLAY = formatWorkspacePath(
  VORATIQ_ENVIRONMENT_FILE,
);

const DEFAULT_ENVIRONMENT_ERROR_CONTEXT =
  "Failed to parse workspace environment configuration";

export interface LoadEnvironmentConfigOptions {
  root?: string;
  filePath?: string;
  optional?: boolean;
}

const loadEnvironmentConfigInternal = createConfigLoader<
  EnvironmentConfig,
  LoadEnvironmentConfigOptions
>({
  resolveFilePath: (root, options) =>
    options.filePath ?? resolveWorkspacePath(root, VORATIQ_ENVIRONMENT_FILE),
  handleMissing: ({ filePath, options }) => {
    if (options.optional) {
      return {};
    }
    throw new MissingEnvironmentConfigError(filePath);
  },
  parse: (content, { filePath }) => {
    try {
      return readEnvironmentConfig(content);
    } catch (error) {
      if (error instanceof EnvironmentConfigParseError) {
        throw error;
      }
      throw new EnvironmentConfigParseError(
        filePath,
        error instanceof Error
          ? error.message
          : DEFAULT_ENVIRONMENT_ERROR_CONTEXT,
      );
    }
  },
});

export function loadEnvironmentConfig(
  options: LoadEnvironmentConfigOptions = {},
): EnvironmentConfig {
  return loadEnvironmentConfigInternal(options);
}

export function readEnvironmentConfig(content: string): EnvironmentConfig {
  const parsed = parseYamlDocument(content, {
    formatError: formatEnvironmentYamlError,
  });
  const config = environmentConfigSchema.parse(parsed);
  return normalizeEnvironmentConfig(config);
}

function formatEnvironmentYamlError(
  detail: YamlParseErrorDetail,
): EnvironmentConfigParseError {
  const errorDetail = formatYamlErrorDetail(detail, {
    fallbackReason: DEFAULT_ENVIRONMENT_ERROR_CONTEXT,
  });
  return new EnvironmentConfigParseError(
    DEFAULT_ENVIRONMENT_FILE_DISPLAY,
    errorDetail,
  );
}

export function serializeEnvironmentConfig(config: EnvironmentConfig): string {
  const lines: string[] = [];

  const nodeDisabled = isNodeEnvironmentDisabled(config);
  const nodeRoots = getNodeDependencyRoots(config);
  const pythonDisabled = isPythonEnvironmentDisabled(config);
  const pythonPath = getPythonEnvironmentPath(config);

  if (nodeDisabled) {
    lines.push("node: false");
    if (pythonPath || pythonDisabled) {
      lines.push("");
    }
  } else if (nodeRoots.length > 0) {
    lines.push("node:");
    lines.push("  dependencyRoots:");
    for (const root of nodeRoots) {
      lines.push(`    - ${root}`);
    }
    if (pythonPath || pythonDisabled) {
      lines.push("");
    }
  }

  if (pythonDisabled) {
    lines.push("python: false");
  } else if (pythonPath && pythonPath.length > 0) {
    lines.push("python:");
    lines.push(`  path: ${pythonPath}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return lines.join("\n");
}
