import { ZodError } from "zod";

import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../utils/yaml-reader.js";
import { VORATIQ_VERIFICATION_CONFIG_FILE } from "../../workspace/constants.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { formatYamlErrorMessage } from "../shared/yaml-error-formatter.js";
import {
  DEFAULT_VERIFICATION_ERROR_CONTEXT,
  MissingVerificationConfigError,
  VerificationConfigError,
  VerificationYamlParseError,
} from "./errors.js";
import { type VerificationConfig, verificationConfigSchema } from "./types.js";

export function readVerificationConfig(content: string): VerificationConfig {
  const parsed = parseYamlDocument(content, {
    formatError: formatVerificationYamlError,
  });

  try {
    return verificationConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((issue) => issue.message)
        .join("; ")
        .trim();
      throw new VerificationConfigError(
        `${DEFAULT_VERIFICATION_ERROR_CONTEXT}: ${detail || "invalid mapping"}`,
      );
    }
    throw error;
  }
}

function formatVerificationYamlError(
  detail: YamlParseErrorDetail,
): VerificationYamlParseError {
  const message = formatYamlErrorMessage(detail, {
    context: DEFAULT_VERIFICATION_ERROR_CONTEXT,
  });
  return new VerificationYamlParseError(message);
}

export interface LoadVerificationConfigOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
}

const loadVerificationConfigInternal = createConfigLoader<
  VerificationConfig,
  LoadVerificationConfigOptions
>({
  resolveFilePath: (root, options) =>
    options.filePath ??
    resolveWorkspacePath(root, VORATIQ_VERIFICATION_CONFIG_FILE),
  selectReadFile: (options) => options.readFile,
  handleMissing: ({ filePath }) => {
    throw new MissingVerificationConfigError(filePath);
  },
  parse: (content) => readVerificationConfig(content),
});

export function loadVerificationConfig(
  options: LoadVerificationConfigOptions = {},
): VerificationConfig {
  return loadVerificationConfigInternal(options);
}
