import chalk from "chalk";

export type TerminalColor =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray";

export function colorize(text: string, color: TerminalColor): string {
  if (!text) {
    return text;
  }

  switch (color) {
    case "red":
      return chalk.red(text);
    case "green":
      return chalk.green(text);
    case "yellow":
      return chalk.yellow(text);
    case "blue":
      return chalk.blue(text);
    case "magenta":
      return chalk.magenta(text);
    case "cyan":
      return chalk.cyan(text);
    case "gray":
    default:
      return chalk.gray(text);
  }
}
