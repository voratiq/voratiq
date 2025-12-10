import { colorize, type TerminalColor } from "./colors.js";

export function formatCliOutput(value: string): string {
  const trimmedEnd = value.trimEnd();
  return `\n${trimmedEnd}\n\n`;
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
