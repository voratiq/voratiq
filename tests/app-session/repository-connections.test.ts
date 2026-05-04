import {
  AppApiError,
  refreshCliSession,
} from "../../src/app-session/api-client.js";
import { ensureAppRepositoryConnection } from "../../src/app-session/repository-connections.js";
import {
  createAuthenticatedRunner,
  readRequestBody,
} from "../support/app-session-api.js";
import {
  buildAppSessionPayload,
  buildAppSessionStateSnapshot,
  buildRepositoryEnsureResponse,
} from "../support/factories/app-session.js";

describe("ensureAppRepositoryConnection", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sends the exact snake_case body and Authorization header", async () => {
    const controller = new AbortController();
    const env = {
      ...process.env,
      VORATIQ_API_ORIGIN: "https://api.example.com",
    };
    const session = buildAppSessionPayload();
    const responsePayload = buildRepositoryEnsureResponse({
      created_repository: true,
      created_connection: true,
    });
    const payload = {
      local_repo_key: "repo-local-key",
      slug: "voratiq",
      display_name: "voratiq",
      git_remote_fingerprint: "sha256:remote",
      git_origin_url: "https://example.com/voratiq.git",
    };
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(responsePayload), { status: 200 }),
    );

    const result = await ensureAppRepositoryConnection(
      { payload, signal: controller.signal, env },
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
        runWithAuthenticatedAppSession: createAuthenticatedRunner({
          now: () => new Date("2026-04-24T01:00:00.000Z"),
          readAppSessionState: () =>
            Promise.resolve(buildAppSessionStateSnapshot(session)),
          refreshCliSession: jest.fn(),
          writeAppSessionState: jest.fn(),
        }),
      },
    );

    expect(result).toEqual(responsePayload);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const requestUrl =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
    expect(requestUrl).toBe(
      "https://api.example.com/api/v1/account/repository-connections/ensure",
    );
    expect(init?.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token-old",
      "content-type": "application/json",
    });
    expect(init?.signal).toBe(controller.signal);
    expect(JSON.parse(readRequestBody(init))).toEqual(payload);
  });

  it("refreshes before repository-link sync when the access token is expired", async () => {
    const env = {
      ...process.env,
      VORATIQ_API_ORIGIN: "https://api.example.com",
    };
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
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockResolvedValue(refreshed);
    const writeMock = jest.fn(() => Promise.resolve("/tmp/app-session.json"));
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(
          buildRepositoryEnsureResponse({
            created_repository: true,
            created_connection: true,
          }),
        ),
        { status: 200 },
      ),
    );

    await ensureAppRepositoryConnection(
      {
        payload: {
          local_repo_key: "repo-local-key",
          slug: "voratiq",
        },
        env,
      },
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
        runWithAuthenticatedAppSession: createAuthenticatedRunner({
          now: () => new Date("2026-04-24T01:00:00.000Z"),
          readAppSessionState: () =>
            Promise.resolve(buildAppSessionStateSnapshot(session)),
          refreshCliSession: refreshMock,
          writeAppSessionState: writeMock,
        }),
      },
    );

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(refreshed, env);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token-new",
      "content-type": "application/json",
    });
  });

  it.each([401, 403])(
    "retries repository-link sync exactly once after a %s response",
    async (statusCode) => {
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
      const refreshMock = jest.fn() as jest.MockedFunction<
        typeof refreshCliSession
      >;
      refreshMock.mockResolvedValue(refreshed);
      const writeMock = jest.fn(() => Promise.resolve("/tmp/app-session.json"));
      const fetchMock = jest.fn<
        ReturnType<typeof fetch>,
        Parameters<typeof fetch>
      >();
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: "Unauthorized",
              },
            }),
            { status: statusCode },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(buildRepositoryEnsureResponse()), {
            status: 200,
          }),
        );

      const result = await ensureAppRepositoryConnection(
        {
          payload: {
            local_repo_key: "repo-local-key",
            slug: "voratiq",
          },
          env: {
            ...process.env,
            VORATIQ_API_ORIGIN: "https://api.example.com",
          },
        },
        {
          fetchImpl: fetchMock as unknown as typeof fetch,
          runWithAuthenticatedAppSession: createAuthenticatedRunner({
            now: () => new Date("2026-04-24T01:00:00.000Z"),
            readAppSessionState: () =>
              Promise.resolve(buildAppSessionStateSnapshot(session)),
            refreshCliSession: refreshMock,
            writeAppSessionState: writeMock,
          }),
        },
      );

      expect(result).toEqual(buildRepositoryEnsureResponse());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer access-token-old",
        "content-type": "application/json",
      });
      expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer access-token-new",
        "content-type": "application/json",
      });
    },
  );

  it("surfaces refresh failures during repository-link sync", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T03:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockRejectedValue(
      new AppApiError("Refresh rejected", "refresh_rejected", 401),
    );

    await expect(
      ensureAppRepositoryConnection(
        {
          payload: {
            local_repo_key: "repo-local-key",
            slug: "voratiq",
          },
        },
        {
          fetchImpl: jest.fn() as unknown as typeof fetch,
          runWithAuthenticatedAppSession: createAuthenticatedRunner({
            now: () => new Date("2026-04-24T03:00:01.000Z"),
            readAppSessionState: () =>
              Promise.resolve(buildAppSessionStateSnapshot(session)),
            refreshCliSession: refreshMock,
            writeAppSessionState: jest.fn(),
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: "AppSessionAuthError",
      code: "refresh_failed",
    });
  });
});
