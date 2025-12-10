import { load } from "js-yaml";

import { toErrorMessage } from "./errors.js";
import { isYamlException } from "./yaml.js";

export interface YamlParseErrorDetail {
  reason?: string;
  message?: string;
  line?: number;
  column?: number;
  error: unknown;
  isYamlError: boolean;
}

export interface ParseYamlDocumentOptions<TError extends Error> {
  emptyValue?: unknown;
  onEmpty?: () => void;
  formatError: (detail: YamlParseErrorDetail) => TError;
}

const DEFAULT_EMPTY_VALUE = {};

export function parseYamlDocument<TError extends Error>(
  content: string,
  options: ParseYamlDocumentOptions<TError>,
): unknown {
  const { emptyValue = DEFAULT_EMPTY_VALUE, onEmpty, formatError } = options;
  const source = content.trim();

  if (source.length === 0) {
    onEmpty?.();
    return emptyValue;
  }

  try {
    const document = load(source, { json: false });
    return document ?? emptyValue;
  } catch (error) {
    throw formatError(buildYamlParseErrorDetail(error));
  }
}

function buildYamlParseErrorDetail(error: unknown): YamlParseErrorDetail {
  if (isYamlException(error)) {
    const { reason, message, mark } = error;
    return {
      reason: reason ?? undefined,
      message: message ?? undefined,
      line:
        typeof mark?.line === "number" && Number.isFinite(mark.line)
          ? mark.line + 1
          : undefined,
      column:
        typeof mark?.column === "number" && Number.isFinite(mark.column)
          ? mark.column + 1
          : undefined,
      error,
      isYamlError: true,
    };
  }

  return {
    message: toErrorMessage(error),
    error,
    isYamlError: false,
  };
}
