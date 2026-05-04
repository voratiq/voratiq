import {
  AppApiError,
  AppSessionRefreshResponseError,
  DEFAULT_CLI_SESSION_REFRESH_WINDOW_MS,
  isAbortError,
  refreshCliSession,
  throwIfAppApiRequestAborted,
} from "./api-client.js";
import type { AppSessionPayload } from "./session.js";
import { writeAppSessionState } from "./session.js";
import { readAppSessionState } from "./state.js";

export type AppSessionAuthErrorCode =
  | "session_missing"
  | "session_expired"
  | "session_read_failed"
  | "session_write_failed"
  | "refresh_failed"
  | "invalid_refresh_response";

export class AppSessionAuthError extends Error {
  constructor(
    message: string,
    readonly code: AppSessionAuthErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppSessionAuthError";
  }
}

export interface AuthenticatedAppSessionRequestContext {
  session: AppSessionPayload;
  accessToken: string;
  signal?: AbortSignal;
}

export interface RunWithAuthenticatedAppSessionOptions<Result> {
  run: (context: AuthenticatedAppSessionRequestContext) => Promise<Result>;
  env?: NodeJS.ProcessEnv;
  refreshWindowMs?: number;
  signal?: AbortSignal;
  isAuthenticationFailure?: (error: unknown) => boolean;
}

interface RunWithAuthenticatedAppSessionDependencies {
  readAppSessionState: typeof readAppSessionState;
  writeAppSessionState: typeof writeAppSessionState;
  refreshCliSession: typeof refreshCliSession;
  now: () => Date;
}

export async function runWithAuthenticatedAppSession<Result>(
  options: RunWithAuthenticatedAppSessionOptions<Result>,
  dependencies: Partial<RunWithAuthenticatedAppSessionDependencies> = {},
): Promise<Result> {
  const env = options.env ?? process.env;
  const refreshWindowMs = normalizeRefreshWindowMs(options.refreshWindowMs);
  const isAuthenticationFailure =
    options.isAuthenticationFailure ?? isAuthenticationFailureByDefault;
  const deps: RunWithAuthenticatedAppSessionDependencies = {
    readAppSessionState,
    writeAppSessionState,
    refreshCliSession,
    now: () => new Date(),
    ...dependencies,
  };

  throwIfAppApiRequestAborted(options.signal);

  let session = await readStoredSessionOrThrow({
    env,
    readAppSessionState: deps.readAppSessionState,
  });

  if (hasExpired(session.session.refreshTokenExpiresAt, deps.now())) {
    throw buildSessionExpiredError();
  }

  let refreshedForRequest = false;
  if (
    shouldRefreshAccessToken(
      session.session.accessTokenExpiresAt,
      deps.now(),
      refreshWindowMs,
    )
  ) {
    session = await refreshAndPersistSession({
      session,
      env,
      signal: options.signal,
      dependencies: deps,
    });
    refreshedForRequest = true;
  }

  throwIfAppApiRequestAborted(options.signal);

  try {
    return await options.run({
      session,
      accessToken: session.session.accessToken,
      signal: options.signal,
    });
  } catch (error) {
    if (!isAuthenticationFailure(error) || refreshedForRequest) {
      throw error;
    }

    if (hasExpired(session.session.refreshTokenExpiresAt, deps.now())) {
      throw buildSessionExpiredError();
    }

    throwIfAppApiRequestAborted(options.signal);

    session = await refreshAndPersistSession({
      session,
      env,
      signal: options.signal,
      dependencies: deps,
    });

    throwIfAppApiRequestAborted(options.signal);

    return await options.run({
      session,
      accessToken: session.session.accessToken,
      signal: options.signal,
    });
  }
}

async function readStoredSessionOrThrow(options: {
  env: NodeJS.ProcessEnv;
  readAppSessionState: typeof readAppSessionState;
}): Promise<AppSessionPayload> {
  try {
    const state = await options.readAppSessionState(options.env);
    if (!state.raw) {
      throw new AppSessionAuthError(
        "Voratiq App login is required. Run `voratiq login`.",
        "session_missing",
      );
    }
    return state.raw;
  } catch (error) {
    if (error instanceof AppSessionAuthError) {
      throw error;
    }
    throw new AppSessionAuthError(
      "Could not read saved Voratiq App sign-in state.",
      "session_read_failed",
      { cause: error },
    );
  }
}

async function refreshAndPersistSession(options: {
  session: AppSessionPayload;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  dependencies: RunWithAuthenticatedAppSessionDependencies;
}): Promise<AppSessionPayload> {
  if (
    hasExpired(
      options.session.session.refreshTokenExpiresAt,
      options.dependencies.now(),
    )
  ) {
    throw buildSessionExpiredError();
  }

  let refreshed: AppSessionPayload;
  try {
    throwIfAppApiRequestAborted(options.signal);
    refreshed = await options.dependencies.refreshCliSession(
      {
        refreshToken: options.session.session.refreshToken,
      },
      {
        env: options.env,
        now: options.dependencies.now,
        signal: options.signal,
      },
    );
  } catch (error) {
    if (isAbortForSignal(error, options.signal)) {
      throw error;
    }

    if (error instanceof AppSessionRefreshResponseError) {
      throw new AppSessionAuthError(
        "Invalid Voratiq App session refresh response.",
        "invalid_refresh_response",
        { cause: error },
      );
    }
    throw new AppSessionAuthError(
      "Voratiq App session refresh failed. Run `voratiq login` again.",
      "refresh_failed",
      { cause: error },
    );
  }

  try {
    await options.dependencies.writeAppSessionState(refreshed, options.env);
  } catch (error) {
    throw new AppSessionAuthError(
      "Could not update saved Voratiq App sign-in state.",
      "session_write_failed",
      {
        cause: error,
      },
    );
  }

  return refreshed;
}

function isAbortForSignal(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true || (signal !== undefined && isAbortError(error))
  );
}

function isAuthenticationFailureByDefault(error: unknown): boolean {
  return (
    error instanceof AppApiError &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

function shouldRefreshAccessToken(
  accessTokenExpiresAt: string,
  now: Date,
  refreshWindowMs: number,
): boolean {
  return Date.parse(accessTokenExpiresAt) - now.getTime() <= refreshWindowMs;
}

function hasExpired(timestamp: string, now: Date): boolean {
  return Date.parse(timestamp) <= now.getTime();
}

function normalizeRefreshWindowMs(refreshWindowMs?: number): number {
  if (
    typeof refreshWindowMs !== "number" ||
    !Number.isFinite(refreshWindowMs) ||
    refreshWindowMs < 0
  ) {
    return DEFAULT_CLI_SESSION_REFRESH_WINDOW_MS;
  }
  return refreshWindowMs;
}

function buildSessionExpiredError(): AppSessionAuthError {
  return new AppSessionAuthError(
    "Voratiq App session expired. Run `voratiq login` again.",
    "session_expired",
  );
}
