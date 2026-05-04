import type { ensureAppRepositoryConnection } from "../app-session/repository-connections.js";
import type { buildRepositoryConnectionEnsureRequest } from "../app-session/repository-link-sync.js";
import {
  readAppSessionState,
  type readRepositoryLinkStateForRepoRoot,
  type writeRepositoryLinkStateForRepoRoot,
} from "../app-session/state.js";
import type { RootLauncherCommandOptions } from "../commands/root-launcher/command.js";
import { runRootLauncherCommand } from "../commands/root-launcher/command.js";
import { isInteractiveShell } from "../utils/terminal.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import { promptForRepositoryLinkIfNeeded } from "./repository-link.js";

export type { RootLauncherCommandOptions as RootLauncherOptions } from "../commands/root-launcher/command.js";

interface InteractiveRootLauncherOptions extends RootLauncherCommandOptions {
  promptForRepositoryLink?: boolean;
  readAppSessionState?: typeof readAppSessionState;
  readRepositoryLinkStateForRepoRoot?: typeof readRepositoryLinkStateForRepoRoot;
  writeRepositoryLinkStateForRepoRoot?: typeof writeRepositoryLinkStateForRepoRoot;
  ensureAppRepositoryConnection?: typeof ensureAppRepositoryConnection;
  buildRepositoryConnectionEnsureRequest?: typeof buildRepositoryConnectionEnsureRequest;
  warn?: (message: string) => void;
}

export function shouldStartRootLauncher(
  argv: readonly string[],
  detectInteractive: () => boolean = () => isInteractiveShell(),
): boolean {
  return argv.length <= 2 && detectInteractive();
}

export async function runInteractiveRootLauncher(
  options: InteractiveRootLauncherOptions = {
    createWorkflow: (workflowOptions) =>
      createConfirmationWorkflow(workflowOptions),
  },
): Promise<void> {
  const {
    promptForRepositoryLink = false,
    readAppSessionState: readSessionState = readAppSessionState,
    readRepositoryLinkStateForRepoRoot: readRepositoryLinkState,
    writeRepositoryLinkStateForRepoRoot: writeRepositoryLinkState,
    ensureAppRepositoryConnection: ensureRepositoryConnection,
    buildRepositoryConnectionEnsureRequest: buildEnsureRequest,
    warn,
    ...commandOptions
  } = options;

  await runRootLauncherCommand({
    ...commandOptions,
    ensureRepositoryLink:
      commandOptions.ensureRepositoryLink ??
      (promptForRepositoryLink
        ? async ({ root, confirm }) => {
            await promptForRepositoryLinkIfNeeded({
              root,
              confirm,
              readAppSessionState: readSessionState,
              readRepositoryLinkStateForRepoRoot: readRepositoryLinkState,
              writeRepositoryLinkStateForRepoRoot: writeRepositoryLinkState,
              ensureAppRepositoryConnection: ensureRepositoryConnection,
              buildRepositoryConnectionEnsureRequest: buildEnsureRequest,
              warn,
            });
          }
        : undefined),
    createWorkflow:
      options.createWorkflow ??
      ((workflowOptions) => createConfirmationWorkflow(workflowOptions)),
  });
}
