import { Command, Option } from "commander";

import {
  executePruneAllCommand,
  executePruneCommand,
} from "../commands/prune/command.js";
import type { PruneAllResult, PruneResult } from "../commands/prune/types.js";
import { resolveCliContext } from "../preflight/index.js";
import {
  renderPruneAllTranscript,
  renderPruneTranscript,
} from "../render/transcripts/prune.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import {
  parseExternalPruneExecutionInput,
  parsePruneCommandSelection,
} from "./contract.js";
import { CliError, NonInteractiveShellError } from "./errors.js";
import {
  buildPruneOperatorEnvelope,
  writeOperatorResultEnvelope,
} from "./operator-envelope.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface PruneCommandOptions {
  runId?: string;
  all?: boolean;
  purge?: boolean;
  yes?: boolean;
  json?: boolean;
  writeOutput?: CommandOutputWriter;
}

export interface PruneCommandResult {
  result: PruneResult | PruneAllResult;
  body: string;
  exitCode?: number;
}

export async function runPruneCommand(
  options: PruneCommandOptions,
): Promise<PruneCommandResult> {
  const { runId } = options;
  const all = Boolean(options.all);
  const purge = Boolean(options.purge);
  const assumeYes = Boolean(options.yes);

  if (options.json && !assumeYes) {
    try {
      parseExternalPruneExecutionInput({
        scope: runId ? "run" : "all",
        ...(runId ? { runId } : {}),
        purge: purge || undefined,
        confirmed: assumeYes,
      });
    } catch {
      throw new CliError(
        "JSON-mode prune requires explicit confirmation.",
        [],
        ["Re-run with `--yes` to confirm the prune."],
      );
    }
  }

  const { root, workspacePaths } = await resolveCliContext();

  const confirmation = createConfirmationWorkflow({
    assumeYes,
    onUnavailable: () => {
      throw new NonInteractiveShellError();
    },
  });

  try {
    if (all) {
      const result = await executePruneAllCommand({
        root,
        runsDir: workspacePaths.runsDir,
        runsFilePath: workspacePaths.runsFile,
        confirm: confirmation.confirm,
        purge,
      });

      const body = renderPruneAllTranscript(result);

      return { result, body };
    }

    if (!runId) {
      throw new CliError(
        "Missing prune target.",
        [],
        ["Provide a run id with `--run <run-id>`."],
      );
    }

    const result = await executePruneCommand({
      root,
      runsDir: workspacePaths.runsDir,
      runsFilePath: workspacePaths.runsFile,
      runId,
      confirm: confirmation.confirm,
      purge,
    });

    const body = renderPruneTranscript(result);

    return { result, body };
  } finally {
    confirmation.close();
  }
}

interface PruneCommandActionOptions {
  run?: string;
  all?: boolean;
  purge?: boolean;
  yes?: boolean;
  json?: boolean;
}

export function createPruneCommand(): Command {
  return new Command("prune")
    .description("Remove run workspaces and mark runs as pruned")
    .addOption(new Option("--run <run-id>", "Run ID to prune").conflicts("all"))
    .addOption(
      new Option("--all", "Prune all non-pruned runs").conflicts("run"),
    )
    .option("--purge", "Delete all associated configs and artifacts")
    .option("-y, --yes", "Skip interactive confirmations")
    .option("--json", "Emit a machine-readable result envelope")
    .allowExcessArguments(false)
    .action(async (options: PruneCommandActionOptions, command: Command) => {
      const selection = parsePruneCommandSelection(options, command);

      const result = await runPruneCommand({
        runId: selection.runId,
        all: selection.all,
        purge: Boolean(selection.purge),
        yes: Boolean(selection.yes),
        json: Boolean(options.json),
        writeOutput: writeCommandOutput,
      });

      if (options.json) {
        writeOperatorResultEnvelope(
          buildPruneOperatorEnvelope({
            status: result.result.status,
            ...("runId" in result.result ? { runId: result.result.runId } : {}),
            ...("runPath" in result.result && result.result.runPath
              ? { runPath: result.result.runPath }
              : {}),
          }),
          result.exitCode,
        );
        return;
      }
      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
