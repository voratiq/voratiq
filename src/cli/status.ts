import { Command } from "commander";

import {
  AppSessionStateReadError,
  type AppSessionStateReadReason,
  type AppSessionStateSnapshot,
  readAppSessionState,
  readRepositoryLinkState,
  type RepositoryLinkStateSnapshot,
} from "../app-session/state.js";
import { renderCliError } from "../render/utils/errors.js";
import { CliError } from "./errors.js";
import { writeCommandOutput } from "./output.js";

export interface StatusCommandResult {
  body: string;
  json: AppStatusJsonOutput;
  exitCode: number;
}

export interface AppStatusJsonSuccessOutput {
  global: {
    path: string;
    signedIn: boolean;
    user: {
      id: string | null;
      email: string | null;
      name: string | null;
    } | null;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
    accessTokenExpired: boolean | null;
    refreshTokenExpired: boolean | null;
  };
  repository: {
    repoRoot: string | null;
    path: string | null;
    exists: boolean;
    linked: boolean | null;
    accountId: string | null;
  };
  effective: {
    linked: boolean;
    reason: "not_signed_in" | "session_expired" | "not_linked" | "linked";
  };
}

export interface AppStatusJsonErrorOutput {
  error: {
    code: "global_state_unreadable" | "repository_link_state_unreadable";
    scope: "global" | "repository";
    reason: AppSessionStateReadReason;
    path: string;
    headline: string;
    hint: string;
  };
}

export type AppStatusJsonOutput =
  | AppStatusJsonSuccessOutput
  | AppStatusJsonErrorOutput;

export async function runStatusCommand(): Promise<StatusCommandResult> {
  let appSessionState: AppSessionStateSnapshot;
  try {
    appSessionState = await readAppSessionState();
  } catch (error) {
    if (error instanceof AppSessionStateReadError) {
      return buildGlobalStateReadFailure(error);
    }
    throw error;
  }

  const accountId = appSessionState.raw?.actor.id;
  let repositoryLinkState: RepositoryLinkStateSnapshot | null = null;
  if (accountId && appSessionState.refreshTokenExpired !== true) {
    try {
      repositoryLinkState = await readRepositoryLinkState(
        process.cwd(),
        process.env,
        accountId,
      );
    } catch (error) {
      if (error instanceof AppSessionStateReadError) {
        return buildRepositoryStateReadFailure(appSessionState, error);
      }
      throw error;
    }
  }

  const effective = resolveAppLinkState(appSessionState, repositoryLinkState);

  const json: AppStatusJsonSuccessOutput = {
    global: {
      path: appSessionState.path,
      signedIn: appSessionState.exists,
      user: appSessionState.user,
      accessTokenExpiresAt: appSessionState.accessTokenExpiresAt,
      refreshTokenExpiresAt: appSessionState.refreshTokenExpiresAt,
      accessTokenExpired: appSessionState.accessTokenExpired,
      refreshTokenExpired: appSessionState.refreshTokenExpired,
    },
    repository: {
      repoRoot: repositoryLinkState?.repoRoot ?? null,
      path: repositoryLinkState?.path ?? null,
      exists: repositoryLinkState?.exists ?? false,
      linked: repositoryLinkState?.linked ?? null,
      accountId: repositoryLinkState?.raw?.accountId ?? null,
    },
    effective,
  };

  return {
    body: renderStatusBody(appSessionState, repositoryLinkState, effective),
    json,
    exitCode: 0,
  };
}

interface StatusCommandActionOptions {
  json?: boolean;
}

export function createStatusCommand(): Command {
  return new Command("status")
    .description("Show Voratiq App sign-in and repository link status")
    .option("--json", "Emit machine-readable status output")
    .allowExcessArguments(false)
    .action(async (options: StatusCommandActionOptions) => {
      const result = await runStatusCommand();
      if (options.json) {
        writeCommandOutput({
          body: JSON.stringify(result.json, null, 2),
          exitCode: result.exitCode === 0 ? undefined : result.exitCode,
        });
        return;
      }

      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode === 0 ? undefined : result.exitCode,
      });
    });
}

function renderStatusBody(
  appSessionState: AppSessionStateSnapshot,
  repositoryLinkState: RepositoryLinkStateSnapshot | null,
  effective: AppStatusJsonSuccessOutput["effective"],
): string {
  switch (effective.reason) {
    case "not_signed_in":
      return [
        "Not signed in to Voratiq App.",
        "",
        "Run `voratiq login` to sign in and link repositories.",
      ].join("\n");
    case "session_expired":
      return ["Sign-in expired.", "", "Run `voratiq login` again."].join("\n");
    case "not_linked":
      return [
        ...renderSignedInLines(appSessionState),
        "",
        repositoryLinkState
          ? "This repository is not linked to Voratiq App."
          : "Run this inside a repository to see its link status.",
      ].join("\n");
    case "linked":
      return [
        ...renderSignedInLines(appSessionState),
        "",
        repositoryLinkState
          ? "This repository is linked to Voratiq App."
          : "Run this inside a repository to see its link status.",
      ].join("\n");
  }
}

function resolveAppLinkState(
  appSessionState: AppSessionStateSnapshot,
  repositoryLinkState: RepositoryLinkStateSnapshot | null,
): AppStatusJsonSuccessOutput["effective"] {
  if (!appSessionState.exists) {
    return { linked: false, reason: "not_signed_in" };
  }

  if (appSessionState.refreshTokenExpired === true) {
    return { linked: false, reason: "session_expired" };
  }

  if (!repositoryLinkState) {
    return { linked: false, reason: "not_linked" };
  }

  if (repositoryLinkState.linked === null) {
    return { linked: false, reason: "not_linked" };
  }

  if (repositoryLinkState.linked === false) {
    return { linked: false, reason: "not_linked" };
  }

  return { linked: true, reason: "linked" };
}

function shouldShowSignedInIdentity(
  appSessionState: AppSessionStateSnapshot,
): boolean {
  return appSessionState.exists && appSessionState.refreshTokenExpired !== true;
}

function renderSignedInLines(
  appSessionState: AppSessionStateSnapshot,
): string[] {
  const user = appSessionState.user;
  const identity = user
    ? `Signed in to Voratiq App as ${user.email ?? user.name ?? user.id}`
    : "Signed in to Voratiq App.";

  return [identity];
}

function buildGlobalStateReadFailure(
  error: AppSessionStateReadError,
): StatusCommandResult {
  const cliError = new CliError(
    "Could not read Voratiq App sign-in state.",
    [],
    [buildStateReadHint(error, "voratiq login")],
  );

  return {
    body: renderCliError(cliError),
    json: {
      error: {
        code: "global_state_unreadable",
        scope: "global",
        reason: error.reason,
        path: error.path,
        headline: cliError.headline,
        hint: cliError.hintLines[0] ?? "",
      },
    },
    exitCode: 1,
  };
}

function buildRepositoryStateReadFailure(
  appSessionState: AppSessionStateSnapshot,
  error: AppSessionStateReadError,
): StatusCommandResult {
  const cliError = new CliError(
    "Could not read repository link state.",
    [],
    [buildStateReadHint(error, "voratiq status")],
  );
  const errorBody = renderCliError(cliError);

  return {
    body: shouldShowSignedInIdentity(appSessionState)
      ? [...renderSignedInLines(appSessionState), "", errorBody].join("\n")
      : errorBody,
    json: {
      error: {
        code: "repository_link_state_unreadable",
        scope: "repository",
        reason: error.reason,
        path: error.path,
        headline: cliError.headline,
        hint: cliError.hintLines[0] ?? "",
      },
    },
    exitCode: 1,
  };
}

function buildStateReadHint(
  error: AppSessionStateReadError,
  command: "voratiq login" | "voratiq status",
): string {
  const filenameHint =
    error.scope === "global" ? "`app-session.json`" : "`repositories.json`";

  if (error.reason === "invalid") {
    return error.scope === "global"
      ? `Fix or remove ${filenameHint}, then run \`voratiq login\` again.`
      : `Fix or remove ${filenameHint}, then run \`voratiq status\` again.`;
  }

  return error.scope === "global"
    ? `Check access to ${filenameHint}, then run \`${command}\` again.`
    : `Check access to ${filenameHint}, then run \`${command}\` again.`;
}
