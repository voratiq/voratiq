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
      "Maximum number of runs to display",
      parseLimitOption,
    )
    .option("--spec <path>", "Filter runs by spec path")
    .option("--run <id>", "Filter runs by run identifier")
    .option("--include-pruned", "Include pruned runs in the listing")
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
