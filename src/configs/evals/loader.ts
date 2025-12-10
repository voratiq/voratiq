import { ZodError } from "zod";

import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../utils/yaml-reader.js";
import {
  resolveWorkspacePath,
  VORATIQ_EVALS_FILE,
} from "../../workspace/structure.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { formatYamlErrorMessage } from "../shared/yaml-error-formatter.js";
import {
  DEFAULT_EVALS_ERROR_CONTEXT,
  EvalsConfigError,
  EvalsYamlParseError,
  MissingEvalsConfigError,
} from "./errors.js";
import {
  type EvalDefinition,
  type EvalsConfig,
  evalsConfigSchema,
} from "./types.js";

export function readEvalsConfig(content: string): EvalsConfig {
  const parsed = parseYamlDocument(content, {
    formatError: formatEvalsYamlError,
  });
  try {
    const config = evalsConfigSchema.parse(parsed);
    return config;
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((issue) => issue.message)
        .join("; ")
        .trim();
      throw new EvalsConfigError(
        `${DEFAULT_EVALS_ERROR_CONTEXT}: ${detail || "invalid mapping"}`,
      );
    }
    throw error;
  }
}

function formatEvalsYamlError(
  detail: YamlParseErrorDetail,
): EvalsYamlParseError {
  const message = formatYamlErrorMessage(detail, {
    context: DEFAULT_EVALS_ERROR_CONTEXT,
  });
  return new EvalsYamlParseError(message);
}

export interface LoadEvalConfigOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
}

const loadEvalConfigInternal = createConfigLoader<
  EvalsConfig,
  LoadEvalConfigOptions
>({
  resolveFilePath: (root, options) =>
    options.filePath ?? resolveWorkspacePath(root, VORATIQ_EVALS_FILE),
  selectReadFile: (options) => options.readFile,
  handleMissing: ({ filePath }) => {
    throw new MissingEvalsConfigError(filePath);
  },
  parse: (content) => readEvalsConfig(content),
});

export function loadEvalConfig(
  options: LoadEvalConfigOptions = {},
): EvalsConfig {
  return loadEvalConfigInternal(options);
}

export function buildEvalDefinitions(config: EvalsConfig): EvalDefinition[] {
  return config.map(({ slug, command }) => ({ slug, command }));
}
