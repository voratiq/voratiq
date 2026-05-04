import { ensureAppRepositoryConnection } from "../app-session/repository-connections.js";
import { buildRepositoryConnectionEnsureRequest } from "../app-session/repository-link-sync.js";
import {
  readAppSessionState,
  readRepositoryLinkStateForRepoRoot,
  writeRepositoryLinkStateForRepoRoot,
} from "../app-session/state.js";
import { toErrorMessage } from "../utils/errors.js";
import {
  VORATIQ_MCP_ACK_OPERATOR_ENV,
  VORATIQ_MCP_ACK_PATH_ENV,
} from "../utils/swarm-session-ack.js";
import { isInteractiveShell } from "../utils/terminal.js";
import { createConfirmationWorkflow } from "./confirmation.js";

const REPOSITORY_LINK_PROMPT = "Link this repository to Voratiq App?";
const REPOSITORY_LINK_PROMPT_PREFACE_LINES = [""];
const REPOSITORY_LINK_FAILED_WARNING =
  "[voratiq] Repository link was not saved because Voratiq App could not confirm the link.";

interface RepositoryLinkConfirmOptions {
  message: string;
  defaultValue: boolean;
  prefaceLines?: string[];
}

export interface PromptForRepositoryLinkOptions {
  root: string;
  json?: boolean;
  env?: NodeJS.ProcessEnv;
  detectInteractive?: () => boolean;
  confirm?: (options: RepositoryLinkConfirmOptions) => Promise<boolean>;
  readAppSessionState?: typeof readAppSessionState;
  readRepositoryLinkStateForRepoRoot?: typeof readRepositoryLinkStateForRepoRoot;
  writeRepositoryLinkStateForRepoRoot?: typeof writeRepositoryLinkStateForRepoRoot;
  ensureAppRepositoryConnection?: typeof ensureAppRepositoryConnection;
  buildRepositoryConnectionEnsureRequest?: typeof buildRepositoryConnectionEnsureRequest;
  warn?: (message: string) => void;
}

export async function promptForRepositoryLinkIfNeeded(
  options: PromptForRepositoryLinkOptions,
): Promise<void> {
  const {
    root,
    json = false,
    env = process.env,
    detectInteractive = () => isInteractiveShell(),
    readAppSessionState: readSessionState = readAppSessionState,
    readRepositoryLinkStateForRepoRoot:
      readRepositoryLinkState = readRepositoryLinkStateForRepoRoot,
    writeRepositoryLinkStateForRepoRoot:
      writeRepositoryLinkState = writeRepositoryLinkStateForRepoRoot,
    ensureAppRepositoryConnection:
      ensureRepositoryConnection = ensureAppRepositoryConnection,
    buildRepositoryConnectionEnsureRequest:
      buildEnsureRequest = buildRepositoryConnectionEnsureRequest,
    warn = (message) => console.warn(message),
  } = options;

  if (
    json ||
    isMcpTriggeredOperatorExecution(env) ||
    (!options.confirm && !detectInteractive())
  ) {
    return;
  }

  const appSessionState = await readSessionState(env);
  const appSessionActive =
    appSessionState.exists && appSessionState.refreshTokenExpired === false;
  const accountId = appSessionState.raw?.actor.id;

  if (!appSessionActive || !accountId) {
    return;
  }

  const repositoryLinkState = await readRepositoryLinkState(
    root,
    env,
    accountId,
  );

  if (repositoryLinkState.linked === true) {
    return;
  }

  if (repositoryLinkState.linked === false) {
    return;
  }

  let workflow: ReturnType<typeof createConfirmationWorkflow> | undefined;
  const confirm =
    options.confirm ??
    ((confirmOptions: RepositoryLinkConfirmOptions) => {
      workflow = createConfirmationWorkflow({
        onUnavailable: () => {
          throw new Error("An interactive terminal is required.");
        },
        detectInteractive,
      });
      return workflow.confirm(confirmOptions);
    });

  try {
    const linked = await confirm({
      message: REPOSITORY_LINK_PROMPT,
      defaultValue: true,
      prefaceLines: REPOSITORY_LINK_PROMPT_PREFACE_LINES,
    });

    if (linked) {
      try {
        await ensureRepositoryConnection({
          env,
          payload: await buildEnsureRequest(root),
        });
      } catch (error) {
        warn(`${REPOSITORY_LINK_FAILED_WARNING} (${toErrorMessage(error)})`);
        return;
      }
    }

    await writeRepositoryLinkState({
      repoRoot: root,
      accountId,
      linked,
      env,
    });

    if (!linked) {
      return;
    }
  } finally {
    workflow?.close();
  }
}

function isMcpTriggeredOperatorExecution(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env[VORATIQ_MCP_ACK_PATH_ENV] || env[VORATIQ_MCP_ACK_OPERATOR_ENV],
  );
}
