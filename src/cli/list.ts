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
  allStatuses?: boolean;
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
    allStatuses: options.allStatuses,
    verbose: options.verbose,
  });

  const body =
    execution.output ??
    (execution.mode === "summary"
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
  allStatuses?: boolean;
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
    .description(
      "Inspect recorded sessions for an operator in summary or detail scope",
    )
    .option(
      "--spec [session-id]",
      "Inspect spec sessions in summary scope or one spec session in detail scope",
    )
    .option(
      "--run [session-id]",
      "Inspect run sessions in summary scope or one run session in detail scope",
    )
    .option(
      "--reduce [session-id]",
      "Inspect reduction sessions in summary scope or one reduction session in detail scope",
    )
    .option(
      "--verify [session-id]",
      "Inspect verification sessions in summary scope or one verification session in detail scope",
    )
    .option(
      "--message [session-id]",
      "Inspect message sessions in summary scope or one message session in detail scope",
    )
    .option(
      "--interactive [session-id]",
      "Inspect interactive sessions in summary scope or one interactive session in detail scope",
    )
    .option(
      "--limit <count>",
      "Show only the N most recent summary sessions (default: 10)",
      parseLimitOption,
    )
    .option(
      "--all-statuses",
      "Include sessions normally hidden by the default summary filter",
    )
    .option(
      "--verbose",
      "Show expanded human detail output (requires detail scope)",
    )
    .option("--json", "Emit machine-readable list output")
    .allowExcessArguments(false)
    .action(async (options: ListCommandActionOptions, command: Command) => {
      const selection = parseListInspectionCommandOptions(options, command);
      const result = await runListCommand({
        operator: selection.operator,
        sessionId:
          selection.mode === "detail" ? selection.sessionId : undefined,
        limit: selection.mode === "summary" ? selection.limit : undefined,
        allStatuses:
          selection.mode === "summary" ? selection.allStatuses : undefined,
        verbose:
          selection.mode === "detail" ? (selection.verbose ?? false) : false,
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
