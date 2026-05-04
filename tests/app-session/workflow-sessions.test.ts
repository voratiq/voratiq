import {
  AppApiError,
  refreshCliSession,
} from "../../src/app-session/api-client.js";
import { createAppWorkflowSession } from "../../src/app-session/workflow-sessions.js";
import {
  createAuthenticatedRunner,
  readRequestBody,
} from "../support/app-session-api.js";
import {
  buildAppSessionPayload,
  buildAppSessionStateSnapshot,
} from "../support/factories/app-session.js";

function buildWorkflowSessionPayload() {
  return {
    local_repo_key: "repo-local-key",
    operator: "run",
    session_id: "20260424-123456-abcde",
    status: "succeeded",
    created_at: "2026-04-24T12:34:56.000Z",
    started_at: "2026-04-24T12:35:01.000Z",
    completed_at: "2026-04-24T12:39:00.000Z",
    record_updated_at: "2026-04-24T12:39:01.000Z",
    target: {
      kind: "spec",
      session_id: "20260424-120000-root1",
    },
  };
}

describe("createAppWorkflowSession", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes before hosted upload when the access token is expired", async () => {
    const controller = new AbortController();
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
    const payload = buildWorkflowSessionPayload();
    const responsePayload = {
      workflow_id: "workflow-123",
      workflow_session_id: "workflow-session-123",
    };
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
      new Response(JSON.stringify(responsePayload), { status: 200 }),
    );

    const result = await createAppWorkflowSession(
      { payload, signal: controller.signal, env },
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

    expect(result).toEqual(responsePayload);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(refreshed, env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const requestInit = init;
    const requestUrl =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
    expect(requestUrl).toBe(
      "https://api.example.com/api/v1/account/workflow-sessions",
    );
    expect(requestInit?.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token-new",
      "content-type": "application/json",
    });
    expect(requestInit?.signal).toBe(controller.signal);
    expect(JSON.parse(readRequestBody(requestInit))).toEqual(payload);
  });

  it.each([401, 403])(
    "retries hosted upload exactly once after a %s response",
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
      const payload = buildWorkflowSessionPayload();
      const responsePayload = {
        workflow_id: "workflow-123",
        workflow_session_id: "workflow-session-123",
      };
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
          new Response(JSON.stringify(responsePayload), { status: 200 }),
        );

      const result = await createAppWorkflowSession(
        {
          payload,
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

      expect(result).toEqual(responsePayload);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(writeMock).toHaveBeenCalledTimes(1);
      const firstRequest = fetchMock.mock.calls[0]?.[1];
      const secondRequest = fetchMock.mock.calls[1]?.[1];

      expect(firstRequest?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer access-token-old",
        "content-type": "application/json",
      });
      expect(secondRequest?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer access-token-new",
        "content-type": "application/json",
      });
    },
  );

  it("does not retry hosted upload when refresh fails", async () => {
    const session = buildAppSessionPayload({
      accessTokenExpiresAt: "2026-04-24T03:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T03:00:00.000Z",
    });
    const payload = buildWorkflowSessionPayload();
    const refreshMock = jest.fn() as jest.MockedFunction<
      typeof refreshCliSession
    >;
    refreshMock.mockRejectedValue(
      new AppApiError("Refresh rejected", "refresh_rejected", 401),
    );
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Unauthorized",
          },
        }),
        { status: 401 },
      ),
    );

    await expect(
      createAppWorkflowSession(
        { payload },
        {
          fetchImpl: fetchMock as unknown as typeof fetch,
          runWithAuthenticatedAppSession: createAuthenticatedRunner({
            now: () => new Date("2026-04-24T01:00:00.000Z"),
            readAppSessionState: () =>
              Promise.resolve(buildAppSessionStateSnapshot(session)),
            refreshCliSession: refreshMock,
            writeAppSessionState: jest.fn(() =>
              Promise.resolve("/tmp/app-session.json"),
            ),
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: "AppSessionAuthError",
      code: "refresh_failed",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
