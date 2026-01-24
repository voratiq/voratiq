import { Command } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeSpecCommand } from "../commands/spec/command.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderSpecTranscript } from "../render/transcripts/spec.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import { NonInteractiveShellError } from "./errors.js";
import { writeCommandOutput } from "./output.js";

export interface SpecCommandOptions {
  description: string;
  agent: string;
  title?: string;
  output?: string;
  yes?: boolean;
  suppressHint?: boolean;
}

export interface SpecCommandResult {
  body: string;
  outputPath: string;
}

export async function runSpecCommand(
  options: SpecCommandOptions,
): Promise<SpecCommandResult> {
  const { description, agent, title, output, yes, suppressHint } = options;

  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();

  const confirmation = createConfirmationWorkflow({
    assumeYes: Boolean(yes),
    onUnavailable: () => {
      throw new NonInteractiveShellError();
    },
  });

  try {
    const result = await executeSpecCommand({
      root,
      specsFilePath: workspacePaths.specsFile,
      description,
      agentId: agent,
      title,
      outputPath: output,
      assumeYes: Boolean(yes),
      interactive: confirmation.interactive,
      confirm: confirmation.confirm,
      prompt: confirmation.prompt,
      onStatus: (message) => {
        writeCommandOutput({ alerts: [{ severity: "info", message }] });
      },
    });

    const body = renderSpecTranscript(result.outputPath, { suppressHint });

    return {
      body,
      outputPath: result.outputPath,
    };
  } finally {
    confirmation.close();
  }
}

export function createSpecCommand(): Command {
  return new Command("spec")
    .description("Generate a structured spec via a sandboxed agent")
    .requiredOption(
      "--description <text>",
      "Human description to convert into a spec",
    )
    .requiredOption("--agent <agent-id>", "Agent identifier to use")
    .option("--title <text>", "Optional spec title")
    .option(
      "--output <path>",
      "Optional output path within .voratiq/specs/ (defaults to <slug>.md)",
    )
    .option("-y, --yes", "Assume yes for prompts (required in non-TTY shells)")
    .allowExcessArguments(false)
    .action(async (commandOptions: SpecCommandOptions) => {
      const result = await runSpecCommand(commandOptions);
      writeCommandOutput({ body: result.body });
    });
}
