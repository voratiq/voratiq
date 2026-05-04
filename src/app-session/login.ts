import { randomUUID } from "node:crypto";

import { CliError } from "../cli/errors.js";
import type { CommandOutputWriter } from "../cli/output.js";
import { colorize } from "../utils/colors.js";
import {
  AppApiError,
  createCliLoginAttempt,
  exchangeCliLoginCode,
  resolveVoratiqAppOrigin,
} from "./api-client.js";
import { openExternalUrl } from "./browser.js";
import {
  AppSignInCallbackError,
  type AppSignInCallbackServer,
  startAppSignInCallbackServer,
} from "./callback.js";
import { type AppSessionPayload, writeAppSessionState } from "./session.js";
import { readAppSessionState } from "./state.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const COMPLETE_PATH = "/auth/cli/complete";

export interface AppSignInDependencies {
  createLoginAttempt: typeof createCliLoginAttempt;
  exchangeLoginCode: typeof exchangeCliLoginCode;
  openExternalUrl: typeof openExternalUrl;
  readAppSessionState: typeof readAppSessionState;
  startCallbackServer: typeof startAppSignInCallbackServer;
  writeAppSessionState: typeof writeAppSessionState;
  randomUUID: typeof randomUUID;
  now: () => Date;
}

export interface AppSignInResult {
  body: string;
  statePath: string;
  session: AppSessionPayload;
}

function emitInfo(
  writeOutput: CommandOutputWriter | undefined,
  message: string,
  options: {
    leadingNewline?: boolean;
  } = {},
) {
  writeOutput?.({
    body: message,
    formatBody: {
      leadingNewline: options.leadingNewline ?? false,
      trailingNewline: false,
    },
  });
}

function toLoginCliError(error: unknown): CliError {
  if (error instanceof AppSignInCallbackError) {
    switch (error.code) {
      case "bind_failed":
        return new CliError(
          "Could not start the local sign-in callback.",
          [],
          [
            "Allow loopback (127.0.0.1) binding for this shell, then run `voratiq login` again.",
          ],
        );
      case "timed_out":
        return new CliError(
          "Timed out waiting for approval.",
          [],
          ["Run `voratiq login` again to retry."],
        );
      case "state_mismatch":
      case "malformed_callback":
        return new CliError(
          "The sign-in callback was invalid.",
          [],
          ["Close the browser tab and run `voratiq login` again."],
        );
    }
  }

  if (error instanceof AppApiError) {
    if (error.code === "cancelled_exchange") {
      return new CliError(
        "Sign-in was cancelled in the browser.",
        [],
        ["Run `voratiq login` again when you're ready."],
      );
    }

    return new CliError(
      "Could not complete sign-in.",
      [],
      ["Check your Voratiq app and API configuration, then try again."],
    );
  }

  return error instanceof CliError
    ? error
    : new CliError(error instanceof Error ? error.message : "Login failed.");
}

function renderLoginSuccess(session: AppSessionPayload): string {
  const signedInAs = session.actor.email ?? session.actor.id;
  return `${colorize("Success:", "green")} Signed in to Voratiq App as ${signedInAs}`;
}

export async function performAppSignIn(
  options: {
    writeOutput?: CommandOutputWriter;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
  dependencies: Partial<AppSignInDependencies> = {},
): Promise<AppSignInResult> {
  const env = options.env ?? process.env;
  const writeOutput = options.writeOutput;
  const deps: AppSignInDependencies = {
    createLoginAttempt: createCliLoginAttempt,
    exchangeLoginCode: exchangeCliLoginCode,
    openExternalUrl,
    readAppSessionState,
    startCallbackServer: startAppSignInCallbackServer,
    writeAppSessionState,
    randomUUID,
    now: () => new Date(),
    ...dependencies,
  };

  const existingState = await deps.readAppSessionState(env);
  const existingInstallationId =
    typeof existingState.raw?.installation.id === "string"
      ? existingState.raw.installation.id
      : null;
  const installationId = existingInstallationId ?? deps.randomUUID();
  const callbackState = deps.randomUUID();

  let callbackServer: AppSignInCallbackServer | null = null;

  try {
    callbackServer = await deps.startCallbackServer({
      expectedState: callbackState,
      completionUrl: new URL(
        COMPLETE_PATH,
        resolveVoratiqAppOrigin(env),
      ).toString(),
    });
    const attempt = await deps.createLoginAttempt(
      {
        installationId,
        callbackUrl: callbackServer.callbackUrl,
        callbackState,
      },
      env,
    );

    emitInfo(writeOutput, "Opening browser to sign in...", {
      leadingNewline: true,
    });
    const opened = await deps.openExternalUrl(attempt.authorizeUrl);
    if (!opened) {
      emitInfo(writeOutput, "Browser didn't open. Open this URL to continue:");
      emitInfo(writeOutput, attempt.authorizeUrl);
    }
    emitInfo(writeOutput, "Waiting for approval in your browser...", {
      leadingNewline: !opened,
    });

    const callback = await callbackServer.waitForResult(
      options.timeoutMs ?? LOGIN_TIMEOUT_MS,
    );
    const session = await deps.exchangeLoginCode({ code: callback.code }, env);
    const statePath = await deps.writeAppSessionState(session, env);

    return {
      body: renderLoginSuccess(session),
      statePath,
      session,
    };
  } catch (error) {
    throw toLoginCliError(error);
  } finally {
    if (callbackServer) {
      await callbackServer.close().catch(() => {});
    }
  }
}
