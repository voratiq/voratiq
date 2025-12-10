import { Command } from "commander";

import { executeInitCommand } from "../commands/init/command.js";
import type { InitCommandResult } from "../commands/init/types.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderInitTranscript } from "../render/transcripts/init.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import { writeCommandOutput } from "./output.js";

export interface RunInitCommandResult extends InitCommandResult {
  body: string;
}

export interface InitCommandOptions {
  yes?: boolean;
}

export async function runInitCommand(
  options: InitCommandOptions = {},
): Promise<RunInitCommandResult> {
  const { root } = await resolveCliContext({ requireWorkspace: false });

  const assumeYes = Boolean(options.yes);
  const confirmation = createConfirmationWorkflow({
    assumeYes,
    onUnavailable: () => {
      throw new Error(
        "Non-interactive shell detected; re-run with --yes to accept defaults.",
      );
    },
  });

  try {
    const initResult = await executeInitCommand({
      root,
      interactive: confirmation.interactive,
      confirm: confirmation.confirm,
      prompt: confirmation.prompt,
    });

    const body = renderInitTranscript(initResult);

    return { ...initResult, body };
  } finally {
    confirmation.close();
  }
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Bootstrap the Voratiq workspace")
    .option("-y, --yes", "Assume yes for all prompts")
    .allowExcessArguments(false)
    .action(async (commandOptions: InitCommandOptions) => {
      const result = await runInitCommand(commandOptions);

      writeCommandOutput({
        body: result.body,
      });
    });
}
