import type { YamlParseErrorDetail } from "../../utils/yaml-reader.js";

export interface FormatYamlErrorOptions {
  /**
   * Contextual prefix for the error message (e.g., "Invalid `agents.yaml`").
   */
  context: string;

  /**
   * Optional file path to include in the error message.
   */
  displayPath?: string;

  /**
   * Default reason to use when the detail provides none.
   */
  fallbackReason?: string;
}

export interface FormatYamlErrorDetailOptions {
  /**
   * Default reason to use when the detail provides none.
   */
  fallbackReason?: string;
}

/**
 * Formats a YAML parse error detail into a consistent error message.
 *
 * The output format varies based on available information:
 * - With displayPath and location: `context: displayPath (line X, column Y): message`
 * - With displayPath only: `context: displayPath: message`
 * - With location only: `context (line X, column Y): message`
 * - Minimal: `context: message`
 */
export function formatYamlErrorMessage(
  detail: YamlParseErrorDetail,
  options: FormatYamlErrorOptions,
): string {
  const { context, displayPath, fallbackReason } = options;
  const message = detail.reason ?? detail.message ?? fallbackReason ?? context;
  const hasLocation =
    typeof detail.line === "number" && typeof detail.column === "number";

  if (displayPath) {
    if (hasLocation) {
      return `${context}: ${displayPath} (line ${detail.line}, column ${detail.column}): ${message}`;
    }
    return `${context}: ${displayPath}: ${message}`;
  }

  if (hasLocation) {
    return `${context} (line ${detail.line}, column ${detail.column}): ${message}`;
  }

  return `${context}: ${message}`;
}

/**
 * Formats only the detail portion of a YAML parse error (for use when the
 * error class adds its own context prefix).
 *
 * The output format varies based on available information:
 * - With location: `(line X, column Y): message`
 * - Without location: `message`
 */
export function formatYamlErrorDetail(
  detail: YamlParseErrorDetail,
  options: FormatYamlErrorDetailOptions = {},
): string {
  const { fallbackReason } = options;
  const message =
    detail.reason ?? detail.message ?? fallbackReason ?? "unknown error";
  const hasLocation =
    typeof detail.line === "number" && typeof detail.column === "number";

  if (hasLocation) {
    return `(line ${detail.line}, column ${detail.column}): ${message}`;
  }

  return message;
}
