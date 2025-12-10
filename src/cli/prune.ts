import { Command } from "commander";

import { executePruneCommand } from "../commands/prune/command.js";
import { InteractiveConfirmationRequiredError } from "../commands/prune/errors.js";
import type { PruneResult } from "../commands/prune/types.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderPruneTranscript } from "../render/transcripts/prune.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import { writeCommandOutput } from "./output.js";

export interface PruneCommandOptions {
  runId: string;
  purge?: boolean;
  yes?: boolean;
}

export interface PruneCommandResult {
  result: PruneResult;
  body: string;
  exitCode?: number;
}

export async function runPruneCommand(
  options: PruneCommandOptions,
): Promise<PruneCommandResult> {
  const { runId } = options;
  const purge = Boolean(options.purge);
  const assumeYes = Boolean(options.yes);

  const { root, workspacePaths } = await resolveCliContext();
  const confirmation = createConfirmationWorkflow({
    assumeYes,
    onUnavailable: () => {
      throw new InteractiveConfirmationRequiredError();
    },
  });

  try {
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
  run: string;
  purge?: boolean;
  yes?: boolean;
}

export function createPruneCommand(): Command {
  return new Command("prune")
    .description("Remove artifacts for a recorded run")
    .requiredOption("--run <run-id>", "Identifier of the run to delete")
    .option("--purge", "Delete all associated configs and artifacts")
    .option("-y, --yes", "Assume yes for all prompts")
    .addHelpText(
      "after",
      "\nThis command removes agent workspaces, deletes agent branches, and marks runs as pruned. \nPass --purge to also delete all associated configs and artifacts.",
    )
    .allowExcessArguments(false)
    .action(async (options: PruneCommandActionOptions) => {
      const result = await runPruneCommand({
        runId: options.run,
        purge: Boolean(options.purge),
        yes: Boolean(options.yes),
      });

      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
