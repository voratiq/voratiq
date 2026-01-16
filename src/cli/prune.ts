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
import { NonInteractiveShellError } from "./errors.js";
import { writeCommandOutput } from "./output.js";

export interface PruneCommandOptions {
  runId?: string;
  all?: boolean;
  purge?: boolean;
  yes?: boolean;
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
      throw new Error("Expected --run <run-id> when --all is not set.");
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
}

export function createPruneCommand(): Command {
  return new Command("prune")
    .description("Remove artifacts for a recorded run")
    .addOption(
      new Option("--run <run-id>", "Identifier of the run to delete").conflicts(
        "all",
      ),
    )
    .addOption(
      new Option("--all", "Prune all non-pruned runs").conflicts("run"),
    )
    .option("--purge", "Delete all associated configs and artifacts")
    .option("-y, --yes", "Assume yes for all prompts")
    .addHelpText(
      "after",
      "\nThis command removes agent workspaces, deletes agent branches, and marks runs as pruned. \nPass --purge to also delete all associated configs and artifacts.",
    )
    .allowExcessArguments(false)
    .action(async (options: PruneCommandActionOptions, command: Command) => {
      const hasRun = typeof options.run === "string" && options.run.length > 0;
      const wantsAll = Boolean(options.all);

      if (!hasRun && !wantsAll) {
        command.error(
          "error: either --run <run-id> or --all must be provided",
          {
            exitCode: 1,
          },
        );
      }

      const result = await runPruneCommand({
        runId: options.run,
        all: wantsAll,
        purge: Boolean(options.purge),
        yes: Boolean(options.yes),
      });

      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
