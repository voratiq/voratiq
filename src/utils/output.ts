import { colorize, type TerminalColor } from "./colors.js";

export interface FormatCliOutputOptions {
  leadingNewline?: boolean;
  trailingNewline?: boolean;
}

export function formatCliOutput(
  value: string,
  options: FormatCliOutputOptions = {},
): string {
  const trimmedEnd = value.trimEnd();
  const leading = options.leadingNewline === false ? "" : "\n";
  const trailing = options.trailingNewline === false ? "\n" : "\n\n";
  return `${leading}${trimmedEnd}${trailing}`;
}

export function formatAlertMessage(
  label: string,
  color: TerminalColor,
  message: string,
): string {
  const prefix = colorize(`${label}:`, color);
  return `${prefix} ${message}`;
}

export function formatErrorMessage(message: string): string {
  return formatAlertMessage("Error", "red", message);
}
