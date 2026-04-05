import type { RootLauncherCommandOptions } from "../commands/root-launcher/command.js";
import { runRootLauncherCommand } from "../commands/root-launcher/command.js";
import { isInteractiveShell } from "../utils/terminal.js";
import { createConfirmationWorkflow } from "./confirmation.js";

export type { RootLauncherCommandOptions as RootLauncherOptions } from "../commands/root-launcher/command.js";

export function shouldStartRootLauncher(
  argv: readonly string[],
  detectInteractive: () => boolean = () => isInteractiveShell(),
): boolean {
  return argv.length <= 2 && detectInteractive();
}

export async function runInteractiveRootLauncher(
  options: RootLauncherCommandOptions = {
    createWorkflow: (workflowOptions) =>
      createConfirmationWorkflow(workflowOptions),
  },
): Promise<void> {
  await runRootLauncherCommand({
    ...options,
    createWorkflow:
      options.createWorkflow ??
      ((workflowOptions) => createConfirmationWorkflow(workflowOptions)),
  });
}
