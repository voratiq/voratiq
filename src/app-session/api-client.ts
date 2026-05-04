import type { AppSessionPayload } from "./session.js";
import { parseAppSessionPayloadFromUnknown } from "./state.js";

const DEFAULT_API_ORIGIN = "https://voratiq-api.fly.dev";
const DEFAULT_APP_ORIGIN = "https://voratiq.com";
export const DEFAULT_CLI_SESSION_REFRESH_WINDOW_MS = 60_000;

export class AppApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AppApiError";
  }
}

export class AppSessionRefreshResponseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppSessionRefreshResponseError";
  }
}

export interface CreateCliLoginAttemptResult {
  attemptId: string;
  authorizeUrl: string;
  expiresAt: string;
}

export interface RefreshCliSessionOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
}

export function resolveVoratiqApiOrigin(env: NodeJS.ProcessEnv = process.env) {
  return env.VORATIQ_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN;
}

export function resolveVoratiqAppOrigin(env: NodeJS.ProcessEnv = process.env) {
  return env.VORATIQ_SITE_URL?.trim() || DEFAULT_APP_ORIGIN;
}

export function buildAppApiUrl(
  path: string,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const origin = resolveVoratiqApiOrigin(options.env ?? process.env);
  return new URL(path, new URL("/api/v1/", origin));
}

export async function readAppApiError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };

    return new AppApiError(
      payload.error?.message ?? `${response.status} ${response.statusText}`,
      payload.error?.code ?? null,
      response.status,
    );
  } catch {
    return new AppApiError(
      `${response.status} ${response.statusText}`,
      null,
      response.status,
    );
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    hasErrorName(error) &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function throwIfAppApiRequestAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  signal.throwIfAborted();
}

export async function createCliLoginAttempt(
  input: {
    installationId: string;
    callbackUrl: string;
    callbackState: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const response = await fetch(buildAppApiUrl("auth/cli/attempts", { env }), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      appOrigin: resolveVoratiqAppOrigin(env),
    }),
  });

  if (!response.ok) {
    throw await readAppApiError(response);
  }

  return (await response.json()) as CreateCliLoginAttemptResult;
}

export async function exchangeCliLoginCode(
  input: {
    code: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppSessionPayload> {
  const response = await fetch(buildAppApiUrl("auth/cli/exchange", { env }), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await readAppApiError(response);
  }

  const payload = (await response.json()) as unknown;
  return parseAppSessionPayloadFromUnknown(
    payload,
    "Voratiq App exchange response",
  );
}

export async function refreshCliSession(
  input: {
    refreshToken: string;
  },
  options: RefreshCliSessionOptions = {},
): Promise<AppSessionPayload> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const response = await fetchImpl(
    buildAppApiUrl("auth/cli/refresh", {
      env,
    }),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: input.refreshToken,
      }),
      signal: options.signal,
    },
  );

  if (!response.ok) {
    throw await readAppApiError(response);
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch (error) {
    throw new AppSessionRefreshResponseError(
      "Invalid Voratiq App refresh response: expected JSON.",
      {
        cause: error,
      },
    );
  }

  let refreshedSession: AppSessionPayload;
  try {
    refreshedSession = parseAppSessionPayloadFromUnknown(
      payload,
      "Voratiq App refresh response",
    );
  } catch (error) {
    throw new AppSessionRefreshResponseError(
      "Invalid Voratiq App refresh response: expected a complete CLI session payload.",
      {
        cause: error,
      },
    );
  }

  validateRefreshedSessionPayload(refreshedSession, now());
  return refreshedSession;
}

function hasErrorName(error: unknown): error is { name: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
  );
}

function validateRefreshedSessionPayload(
  payload: AppSessionPayload,
  now: Date,
): void {
  const nowMs = now.getTime();
  const accessTokenExpiresAt = Date.parse(payload.session.accessTokenExpiresAt);
  const refreshTokenExpiresAt = Date.parse(
    payload.session.refreshTokenExpiresAt,
  );

  if (!Number.isFinite(accessTokenExpiresAt) || accessTokenExpiresAt <= nowMs) {
    throw new AppSessionRefreshResponseError(
      "Invalid Voratiq App refresh response: access token expiry is unusable.",
    );
  }

  if (
    !Number.isFinite(refreshTokenExpiresAt) ||
    refreshTokenExpiresAt <= nowMs
  ) {
    throw new AppSessionRefreshResponseError(
      "Invalid Voratiq App refresh response: refresh token expiry is unusable.",
    );
  }

  if (refreshTokenExpiresAt <= accessTokenExpiresAt) {
    throw new AppSessionRefreshResponseError(
      "Invalid Voratiq App refresh response: refresh token expires too early.",
    );
  }
}
