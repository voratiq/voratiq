import { Command, Option } from "commander";

import { executeInitCommand } from "../commands/init/command.js";
import type { InitCommandResult } from "../commands/init/types.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderInitTranscript } from "../render/transcripts/init.js";
import type { AgentPreset } from "../workspace/templates.js";
import { AGENT_PRESET_CHOICES } from "../workspace/templates.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import { NonInteractiveShellError } from "./errors.js";
import { writeCommandOutput } from "./output.js";

export interface RunInitCommandResult extends InitCommandResult {
  body: string;
}

export interface InitCommandOptions {
  yes?: boolean;
  preset?: AgentPreset;
  presetProvided?: boolean;
}

export async function runInitCommand(
  options: InitCommandOptions = {},
): Promise<RunInitCommandResult> {
  const { root } = await resolveCliContext({ requireWorkspace: false });

  const assumeYes = Boolean(options.yes);
  const preset: AgentPreset = options.preset ?? "pro";
  const presetProvided = Boolean(options.presetProvided);
  const confirmation = createConfirmationWorkflow({
    assumeYes,
    onUnavailable: () => {
      throw new NonInteractiveShellError();
    },
  });

  try {
    const initResult = await executeInitCommand({
      root,
      preset,
      presetProvided,
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
  const presetOption = new Option(
    "--preset <preset>",
    "Select the agent preset",
  )
    .choices(AGENT_PRESET_CHOICES)
    .default("pro");

  return new Command("init")
    .description("Bootstrap the Voratiq workspace")
    .option("-y, --yes", "Assume yes for all prompts")
    .addOption(presetOption)
    .allowExcessArguments(false)
    .action(async (commandOptions: InitCommandOptions, command: Command) => {
      const presetSource = command.getOptionValueSource("preset");
      const presetProvided =
        typeof presetSource === "string" && presetSource !== "default";
      const result = await runInitCommand({
        ...commandOptions,
        presetProvided,
      });

      writeCommandOutput({
        body: result.body,
      });
    });
}
