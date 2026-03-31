import { Command } from "commander";

import {
  executeListCommand,
  type ListJsonOutput,
  type ListOperator,
} from "../commands/list/command.js";
import { resolveCliContext } from "../preflight/index.js";
import { parsePositiveInteger } from "../utils/validators.js";
import {
  resolveWorkspacePath,
  VORATIQ_REDUCTION_FILE,
  VORATIQ_VERIFICATION_FILE,
} from "../workspace/structure.js";
import { type Alert, writeCommandOutput } from "./output.js";

export interface ListCommandOptions {
  operator: ListOperator;
  sessionId?: string;
  limit?: number;
  verbose?: boolean;
}

export interface ListCommandResult {
  alerts: Alert[];
  body: string;
  json: ListJsonOutput;
}

export async function runListCommand(
  options: ListCommandOptions,
): Promise<ListCommandResult> {
  const { root, workspacePaths } = await resolveCliContext({
    requireWorkspace: false,
  });

  const execution = await executeListCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    runsFilePath: workspacePaths.runsFile,
    reductionsFilePath:
      workspacePaths.reductionsFile ??
      resolveWorkspacePath(root, VORATIQ_REDUCTION_FILE),
    verificationsFilePath:
      workspacePaths.verificationsFile ??
      resolveWorkspacePath(root, VORATIQ_VERIFICATION_FILE),
    operator: options.operator,
    sessionId: options.sessionId,
    limit: options.limit,
    verbose: options.verbose,
  });

  const body =
    execution.output ??
    (execution.mode === "table"
      ? `No ${options.operator} sessions recorded.`
      : `${options.operator} session \`${options.sessionId}\` not found.`);
  const alerts: Alert[] = execution.warnings.map((warning) => ({
    severity: "warn",
    message: warning,
  }));

  return { alerts, body, json: execution.json };
}

interface ListCommandActionOptions {
  spec?: string | boolean;
  run?: string | boolean;
  reduce?: string | boolean;
  verify?: string | boolean;
  limit?: number;
  verbose?: boolean;
  json?: boolean;
}

function parseLimitOption(value: string): number {
  return parsePositiveInteger(
    value,
    "Expected positive integer after --limit",
    "--limit must be greater than 0",
  );
}

export function createListCommand(): Command {
  return new Command("list")
    .description("List recorded sessions for an operator")
    .option(
      "--spec [session-id]",
      "List spec sessions or show one spec session",
    )
    .option("--run [session-id]", "List run sessions or show one run session")
    .option(
      "--reduce [session-id]",
      "List reduction sessions or show one reduction session",
    )
    .option(
      "--verify [session-id]",
      "List verification sessions or show one verification session",
    )
    .option(
      "--limit <count>",
      "Show only the N most recent sessions (default: 10)",
      parseLimitOption,
    )
    .option(
      "--verbose",
      "Show all statuses for the selected operator in table mode",
    )
    .option("--json", "Emit machine-readable list output")
    .allowExcessArguments(false)
    .action(async (options: ListCommandActionOptions, command: Command) => {
      const selection = resolveOperatorSelection(options, command);
      const result = await runListCommand({
        operator: selection.operator,
        sessionId: selection.sessionId,
        limit: options.limit,
        verbose: Boolean(options.verbose),
      });

      if (options.json) {
        writeCommandOutput({
          body: JSON.stringify(result.json),
        });
        return;
      }
      writeCommandOutput({
        body: result.body,
        alerts: result.alerts,
      });
    });
}

function resolveOperatorSelection(
  options: ListCommandActionOptions,
  command: Command,
): { operator: ListOperator; sessionId?: string } {
  const entries = [
    { operator: "spec" as const, value: options.spec, flag: "--spec" },
    { operator: "run" as const, value: options.run, flag: "--run" },
    { operator: "reduce" as const, value: options.reduce, flag: "--reduce" },
    { operator: "verify" as const, value: options.verify, flag: "--verify" },
  ].filter((entry) => entry.value !== undefined);

  if (entries.length !== 1) {
    const provided = entries.map((entry) => entry.flag).join(", ");
    const detail =
      entries.length === 0
        ? "No operator flag was provided."
        : `Provided: ${provided}.`;
    command.error(
      `error: exactly one operator flag is required: \`--spec\`, \`--run\`, \`--reduce\`, or \`--verify\` (${detail})`,
      { exitCode: 1 },
    );
  }

  const selected = entries[0];
  if (!selected) {
    command.error(
      "error: exactly one operator flag is required: `--spec`, `--run`, `--reduce`, or `--verify`",
      { exitCode: 1 },
    );
  }

  return {
    operator: selected.operator,
    sessionId:
      typeof selected.value === "string" && selected.value.length > 0
        ? selected.value
        : undefined,
  };
}
