import { Command } from "commander";

import { executeListCommand } from "../commands/list/command.js";
import type { ListJsonOutput, ListOperator } from "../contracts/list.js";
import { resolveCliContext } from "../preflight/index.js";
import { parsePositiveInteger } from "../utils/validators.js";
import {
  VORATIQ_INTERACTIVE_FILE,
  VORATIQ_MESSAGE_FILE,
  VORATIQ_REDUCTION_FILE,
  VORATIQ_VERIFICATION_FILE,
} from "../workspace/constants.js";
import { resolveWorkspacePath } from "../workspace/path-resolvers.js";
import { parseListInspectionCommandOptions } from "./contract.js";
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
    messagesFilePath:
      workspacePaths.messagesFile ??
      resolveWorkspacePath(root, VORATIQ_MESSAGE_FILE),
    verificationsFilePath:
      workspacePaths.verificationsFile ??
      resolveWorkspacePath(root, VORATIQ_VERIFICATION_FILE),
    interactiveFilePath:
      workspacePaths.interactiveFile ??
      resolveWorkspacePath(root, VORATIQ_INTERACTIVE_FILE),
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
  message?: string | boolean;
  interactive?: string | boolean;
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
      "--message [session-id]",
      "List message sessions or show one message session",
    )
    .option(
      "--interactive [session-id]",
      "List interactive sessions or show one interactive session",
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
      const selection = parseListInspectionCommandOptions(options, command);
      const result = await runListCommand({
        operator: selection.operator,
        sessionId:
          selection.mode === "detail" ? selection.sessionId : undefined,
        limit: selection.limit,
        verbose: selection.verbose ?? false,
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
