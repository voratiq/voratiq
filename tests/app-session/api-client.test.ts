import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AppApiError,
  AppSessionRefreshResponseError,
  buildAppApiUrl,
  refreshCliSession,
  resolveVoratiqAppOrigin,
} from "../../src/app-session/api-client.js";
import {
  AppSessionAuthError,
  runWithAuthenticatedAppSession,
} from "../../src/app-session/authenticated-api.js";
import { readAppSessionState } from "../../src/app-session/state.js";
import {
  buildAppSessionPayload,
  buildAppSessionStateSnapshot,
} from "../support/factories/app-session.js";

describe("app-session authenticated API behavior", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("defaults app API calls to hosted Voratiq", () => {
    const env = {} as NodeJS.ProcessEnv;

    expect(buildAppApiUrl("auth/cli/attempts", { env }).toString()).toBe(
      "https://voratiq-api.fly.dev/api/v1/auth/cli/attempts",
    );
    expect(resolveVoratiqAppOrigin(env)).toBe("https://voratiq.com");
  });

  it("honors local app API origin overrides", () => {
    const env = {
      VORATIQ_API_ORIGIN: "http://127.0.0.1:4040",
      VORATIQ_SITE_URL: "http://localhost:3000",
    } as NodeJS.ProcessEnv;

    expect(buildAppApiUrl("auth/cli/attempts", { env }).toString()).toBe(
      "http://127.0.0.1:4040/api/v1/auth/cli/attempts",
    );
    expect(resolveVoratiqAppOrigin(env)).toBe("http://localhost:3000");
  });

  it("calls /auth/cli/refresh with the stored refresh token", async () => {
    const controller = new AbortController();
    const refreshed = buildAppSessionPayload({
      accessToken: "access-token-new",
      refreshToken: "refresh-token-new",
      accessTokenExpiresAt: "2026-04-24T04:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T04:00:00.000Z",
    });
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(refreshed), { status: 200 }),
    );

    const result = await refreshCliSession(
      {
        refreshToken: "refresh-token-old",
      },
      {
        env: {
          ...process.env,
          VORATIQ_API_ORIGIN: "https://api.example.com",
        },
        fetchImpl: fetchMock as unknown as typeof fetch,
        now: () => new Date("2026-04-24T01:00:00.000Z"),
        signal: controller.signal,
      },
    );

    expect(result.session.accessToken).toBe("access-token-new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const requestUrl =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
    expect(requestUrl).toBe("https://api.example.com/api/v1/auth/cli/refresh");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).signal).toBe(controller.signal);
    const requestBody = (init as RequestInit).body;
    if (typeof requestBody !== "string") {
      throw new Error("Expected refresh request body to be a JSON string.");
    }
    expect(JSON.parse(requestBody)).toEqual({
      refreshToken: "refresh-token-old",
    });
  });

  it("does not refresh when access token is still outside the refresh window", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T03:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const runMock = jest.fn(() => Promise.resolve("ok"));
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    const writeMock = jest.fn(() => Promise.resolve("/tmp/app-session.json"));

    const result = await runWithAuthenticatedAppSession(
      {
        refreshWindowMs: 60_000,
        run: runMock,
      },
      {
        now: () => new Date("2026-04-24T01:00:00.000Z"),
        readAppSessionState: () =>
          Promise.resolve(buildAppSessionStateSnapshot(session)),
        refreshCliSession: refreshMock,
        writeAppSessionState: writeMock,
      },
    );

    expect(result).toBe("ok");
    expect(refreshMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token-old",
      }),
    );
  });

  it("refreshes before running when access token is expired", async () => {
    const controller = new AbortController();
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T00:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const refreshed = buildAppSessionPayload({
      accessToken: "access-token-new",
      refreshToken: "refresh-token-new",
      accessTokenExpiresAt: "2026-04-24T04:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T04:00:00.000Z",
    });
    const runMock = jest.fn(() => Promise.resolve("ok"));
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockResolvedValue(refreshed);
    const writeMock = jest.fn(() => Promise.resolve("/tmp/app-session.json"));

    await runWithAuthenticatedAppSession(
      {
        refreshWindowMs: 60_000,
        signal: controller.signal,
        run: runMock,
      },
      {
        now: () => new Date("2026-04-24T01:00:00.000Z"),
        readAppSessionState: () =>
          Promise.resolve(buildAppSessionStateSnapshot(session)),
        refreshCliSession: refreshMock,
        writeAppSessionState: writeMock,
      },
    );

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith(
      {
        refreshToken: "refresh-token-old",
      },
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(refreshed, process.env);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token-new",
        signal: controller.signal,
      }),
    );
  });

  it("refreshes before running when access token is inside the refresh window", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T01:00:20.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const refreshed = buildAppSessionPayload({
      accessToken: "access-token-new",
      refreshToken: "refresh-token-new",
      accessTokenExpiresAt: "2026-04-24T04:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T04:00:00.000Z",
    });
    const runMock = jest.fn(() => Promise.resolve("ok"));
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockResolvedValue(refreshed);

    await runWithAuthenticatedAppSession(
      {
        refreshWindowMs: 60_000,
        run: runMock,
      },
      {
        now: () => new Date("2026-04-24T01:00:00.000Z"),
        readAppSessionState: () =>
          Promise.resolve(buildAppSessionStateSnapshot(session)),
        refreshCliSession: refreshMock,
        writeAppSessionState: () => Promise.resolve("/tmp/app-session.json"),
      },
    );

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token-new",
      }),
    );
  });

  it("retries exactly once after refresh and surfaces retried request failure", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T03:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const refreshed = buildAppSessionPayload({
      accessToken: "access-token-new",
      refreshToken: "refresh-token-new",
      accessTokenExpiresAt: "2026-04-24T04:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T04:00:00.000Z",
    });
    const runMock = jest
      .fn(() => Promise.resolve("ok"))
      .mockRejectedValueOnce(new AppApiError("Unauthorized", null, 401))
      .mockRejectedValueOnce(new AppApiError("Still unauthorized", null, 401));
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockResolvedValue(refreshed);
    const writeMock = jest.fn(() => Promise.resolve("/tmp/app-session.json"));

    await expect(
      runWithAuthenticatedAppSession(
        {
          refreshWindowMs: 60_000,
          run: runMock,
        },
        {
          now: () => new Date("2026-04-24T01:00:00.000Z"),
          readAppSessionState: () =>
            Promise.resolve(buildAppSessionStateSnapshot(session)),
          refreshCliSession: refreshMock,
          writeAppSessionState: writeMock,
        },
      ),
    ).rejects.toMatchObject({
      name: "AppApiError",
      statusCode: 401,
      message: "Still unauthorized",
    } satisfies Partial<AppApiError>);

    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accessToken: "access-token-old",
      }),
    );
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accessToken: "access-token-new",
      }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it("does not call refresh when refresh token is already expired", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T03:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-24T00:30:00.000Z",
    });
    const runMock = jest.fn(() => Promise.resolve("ok"));
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;

    await expect(
      runWithAuthenticatedAppSession(
        {
          run: runMock,
        },
        {
          now: () => new Date("2026-04-24T01:00:00.000Z"),
          readAppSessionState: () =>
            Promise.resolve(buildAppSessionStateSnapshot(session)),
          refreshCliSession: refreshMock,
        },
      ),
    ).rejects.toMatchObject({
      name: "AppSessionAuthError",
      code: "session_expired",
    } satisfies Partial<AppSessionAuthError>);

    expect(runMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not retry the original request when refresh is rejected", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T03:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const runMock = jest
      .fn(() => Promise.resolve("ok"))
      .mockRejectedValueOnce(new AppApiError("Unauthorized", null, 401));
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockRejectedValue(
      new AppApiError("Refresh rejected", "refresh_rejected", 401),
    );
    const writeMock = jest.fn(() => Promise.resolve("/tmp/app-session.json"));

    await expect(
      runWithAuthenticatedAppSession(
        {
          run: runMock,
        },
        {
          now: () => new Date("2026-04-24T01:00:00.000Z"),
          readAppSessionState: () =>
            Promise.resolve(buildAppSessionStateSnapshot(session)),
          refreshCliSession: refreshMock,
          writeAppSessionState: writeMock,
        },
      ),
    ).rejects.toMatchObject({
      name: "AppSessionAuthError",
      code: "refresh_failed",
    } satisfies Partial<AppSessionAuthError>);

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("keeps the previous session file when refresh response is invalid", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "voratiq-app-refresh-"));
    const env = { ...process.env, HOME: home };
    await mkdir(path.join(home, ".voratiq"), { recursive: true });
    const sessionPath = path.join(home, ".voratiq", "app-session.json");
    const existingSession = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T00:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    await writeFile(
      sessionPath,
      `${JSON.stringify(existingSession, null, 2)}\n`,
      {
        encoding: "utf8",
      },
    );
    const originalContent = await readFile(sessionPath, "utf8");

    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ version: 1 }), { status: 200 }),
    );

    try {
      await expect(
        runWithAuthenticatedAppSession(
          {
            env,
            run: () =>
              Promise.reject(
                new Error("run should not execute when pre-refresh fails"),
              ),
          },
          {
            now: () => new Date("2026-04-24T01:00:00.000Z"),
            refreshCliSession: (input, options) =>
              refreshCliSession(input, {
                ...options,
                fetchImpl: fetchMock as unknown as typeof fetch,
              }),
          },
        ),
      ).rejects.toMatchObject({
        name: "AppSessionAuthError",
        code: "invalid_refresh_response",
      } satisfies Partial<AppSessionAuthError>);

      const storedContent = await readFile(sessionPath, "utf8");
      expect(storedContent).toBe(originalContent);
      const state = await readAppSessionState(env);
      expect(state.raw?.session.accessToken).toBe("access-token-old");
      expect(state.raw?.session.refreshToken).toBe("refresh-token-old");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects refresh responses with unusable expiry timestamps", async () => {
    const invalidResponse = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T00:30:00.000Z",
      refreshTokenExpiresAt: "2026-04-24T00:35:00.000Z",
    });
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(invalidResponse), { status: 200 }),
    );

    await expect(
      refreshCliSession(
        {
          refreshToken: "refresh-token-old",
        },
        {
          env: {
            ...process.env,
            VORATIQ_API_ORIGIN: "https://api.example.com",
          },
          fetchImpl: fetchMock as unknown as typeof fetch,
          now: () => new Date("2026-04-24T01:00:00.000Z"),
        },
      ),
    ).rejects.toBeInstanceOf(AppSessionRefreshResponseError);
  });
});
