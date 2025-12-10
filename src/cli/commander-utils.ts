import type { CommanderError } from "commander";

export const COMMANDER_SELF_RENDERED_CODES: ReadonlySet<string> = new Set([
  "commander.conflictingOption",
  "commander.error",
  "commander.excessArguments",
  "commander.help",
  "commander.helpDisplayed",
  "commander.invalidArgument",
  "commander.missingArgument",
  "commander.missingMandatoryOptionValue",
  "commander.optionMissingArgument",
  "commander.unknownCommand",
  "commander.unknownOption",
  "commander.version",
]);

export function commanderAlreadyRendered(error: CommanderError): boolean {
  if (!error.code) {
    return false;
  }

  if (COMMANDER_SELF_RENDERED_CODES.has(error.code)) {
    return true;
  }

  if (
    error.code.startsWith("commander.") &&
    error.message.startsWith("error:")
  ) {
    return true;
  }

  return false;
}
