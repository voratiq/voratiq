import type { Command } from "commander";

export function silenceCommander(command: Command): Command {
  return command.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
    outputError: () => {},
  });
}
