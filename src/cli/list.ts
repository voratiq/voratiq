import { Command } from "commander";

import { executeListCommand } from "../commands/list/command.js";
import { resolveCliContext } from "../preflight/index.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { type Alert, writeCommandOutput } from "./output.js";

export interface ListCommandOptions {
  limit?: number;
  spec?: string;
  run?: string;
  includePruned?: boolean;
}

export interface ListCommandResult {
  alerts: Alert[];
  body: string;
}

export async function runListCommand(
  options: ListCommandOptions = {},
): Promise<ListCommandResult> {
  const { root, workspacePaths } = await resolveCliContext({
    requireWorkspace: false,
  });

  const execution = await executeListCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    limit: options.limit,
    specPath: options.spec,
    runId: options.run,
    includePruned: options.includePruned,
  });

  const body = execution.output ?? "No runs recorded.";
  const alerts: Alert[] = execution.warnings.map((warning) => ({
    severity: "warn",
    message: warning,
  }));

  return { alerts, body };
}

interface ListCommandActionOptions {
  limit?: number;
  spec?: string;
  run?: string;
  includePruned?: boolean;
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
    .description("List recorded runs")
    .option(
      "--limit <count>",
      "Show only the N most recent runs (default: 10)",
      parseLimitOption,
    )
    .option("--spec <path>", "Filter by spec path")
    .option("--run <run-id>", "Show only the specified run ID")
    .option("--include-pruned", "Include runs marked as pruned")
    .allowExcessArguments(false)
    .action(async (options: ListCommandActionOptions) => {
      const result = await runListCommand({
        limit: options.limit,
        spec: options.spec,
        run: options.run,
        includePruned: options.includePruned,
      });

      writeCommandOutput({
        body: result.body,
        alerts: result.alerts,
      });
    });
}
