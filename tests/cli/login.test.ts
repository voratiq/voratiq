import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";

import { AppApiError } from "../../src/app-session/api-client.js";
import {
  AppSignInCallbackError,
  startAppSignInCallbackServer,
} from "../../src/app-session/callback.js";
import * as appSignInModule from "../../src/app-session/login.js";
import { readAppSessionState } from "../../src/app-session/state.js";
import { createLoginCommand, runLoginCommand } from "../../src/cli/login.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import { silenceCommander } from "../support/commander.js";
import {
  buildAppSessionPayload,
  signedOutAppSessionState,
} from "../support/factories/app-session.js";

jest.mock("../../src/cli/output.js", () => ({
  writeCommandOutput: jest.fn(),
}));

const writeCommandOutputMock = jest.mocked(writeCommandOutput);
const generatedUuid = "00000000-0000-4000-8000-000000000000";
const session = buildAppSessionPayload({
  session: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: "2026-04-22T18:00:00.000Z",
    refreshTokenExpiresAt: "2026-05-22T18:00:00.000Z",
  },
  actor: {
    name: null,
    scopes: ["hosted:read"],
  },
});

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  const ansiPattern = new RegExp(`${esc}\\[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
}

async function canBindLocalhost(): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    }).catch(() => {});
  }
}

describe("Voratiq App sign-in callback server", () => {
  const completionUrl = "http://localhost:3000/auth/cli/complete";
  let localhostBindingAvailable = true;

  beforeAll(async () => {
    localhostBindingAvailable = await canBindLocalhost();
  });

  it("captures a valid callback response", async () => {
    if (!localhostBindingAvailable) {
      return;
    }

    const server = await startAppSignInCallbackServer({
      expectedState: "state-123",
      completionUrl,
    });

    const resultPromise = server.waitForResult(1_000);
    const response = await fetch(
      `${server.callbackUrl}?code=code-123&state=state-123`,
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(completionUrl);
    await expect(resultPromise).resolves.toEqual({ code: "code-123" });
  });

  it("rejects malformed callbacks without an exchange code", async () => {
    if (!localhostBindingAvailable) {
      return;
    }

    const server = await startAppSignInCallbackServer({
      expectedState: "state-123",
      completionUrl,
    });

    const resultPromise = server.waitForResult(1_000);
    const resultAssertion = resultPromise.then(
      () => {
        throw new Error("Expected malformed callback to reject.");
      },
      (error: unknown) => {
        expect(error).toMatchObject({
          code: "malformed_callback",
        } satisfies Partial<AppSignInCallbackError>);
      },
    );
    const response = await fetch(`${server.callbackUrl}?state=state-123`, {
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${completionUrl}?status=failed&reason=malformed_callback`,
    );
    await resultAssertion;
  });

  it("rejects callbacks with the wrong state", async () => {
    if (!localhostBindingAvailable) {
      return;
    }

    const server = await startAppSignInCallbackServer({
      expectedState: "state-123",
      completionUrl,
    });

    const resultPromise = server.waitForResult(1_000);
    const resultAssertion = resultPromise.then(
      () => {
        throw new Error("Expected state mismatch callback to reject.");
      },
      (error: unknown) => {
        expect(error).toMatchObject({
          code: "state_mismatch",
        } satisfies Partial<AppSignInCallbackError>);
      },
    );
    const response = await fetch(
      `${server.callbackUrl}?code=code-123&state=wrong-state`,
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${completionUrl}?status=failed&reason=state_mismatch`,
    );
    await resultAssertion;
  });

  it("times out when the browser never returns", async () => {
    if (!localhostBindingAvailable) {
      return;
    }

    const server = await startAppSignInCallbackServer({
      expectedState: "state-123",
      completionUrl,
    });

    await expect(server.waitForResult(10)).rejects.toMatchObject({
      code: "timed_out",
    } satisfies Partial<AppSignInCallbackError>);
  });

  it("fails cleanly when the localhost callback port is unavailable", async () => {
    if (!localhostBindingAvailable) {
      return;
    }

    const firstServer = await startAppSignInCallbackServer({
      expectedState: "state-123",
      completionUrl,
      port: 45678,
    });

    await expect(
      startAppSignInCallbackServer({
        expectedState: "state-456",
        completionUrl,
        port: 45678,
      }),
    ).rejects.toMatchObject({
      code: "bind_failed",
    } satisfies Partial<AppSignInCallbackError>);

    await firstServer.close();
  });
});

describe("voratiq login", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("persists app session state and emits the new sign-in progress flow", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "voratiq-login-home-"));
    try {
      const infoMessages: string[] = [];

      const result = await appSignInModule.performAppSignIn(
        {
          env: { ...process.env, HOME: home },
          writeOutput: (payload) => {
            const body = payload.body;
            if (typeof body === "string") {
              infoMessages.push(body);
            }
          },
        },
        {
          readAppSessionState: () =>
            Promise.resolve(
              signedOutAppSessionState({
                path: path.join(home, ".voratiq", "app-session.json"),
              }),
            ),
          randomUUID: () => generatedUuid,
          startCallbackServer: () =>
            Promise.resolve({
              callbackUrl: "http://127.0.0.1:45511/callback",
              waitForResult: () => Promise.resolve({ code: "exchange-code" }),
              close: () => Promise.resolve(),
            }),
          createLoginAttempt: () =>
            Promise.resolve({
              attemptId: "attempt-123",
              authorizeUrl:
                "http://localhost:3000/auth/cli?attempt=attempt-123",
              expiresAt: "2026-04-22T18:00:00.000Z",
            }),
          openExternalUrl: () => Promise.resolve(true),
          exchangeLoginCode: () => Promise.resolve(session),
        },
      );

      const storedState = await readAppSessionState({
        ...process.env,
        HOME: home,
      });

      expect(stripAnsi(result.body)).toBe(
        "Success: Signed in to Voratiq App as qa@example.com",
      );
      expect(result.statePath).toBe(
        path.join(home, ".voratiq", "app-session.json"),
      );
      expect(infoMessages).toEqual([
        "Opening browser to sign in...",
        "Waiting for approval in your browser...",
      ]);
      expect(storedState.exists).toBe(true);
      expect(storedState.path).toBe(
        path.join(home, ".voratiq", "app-session.json"),
      );
      expect(storedState.user?.email).toBe("qa@example.com");
      expect(storedState.raw).toMatchObject({
        installation: {
          id: "install-123",
        },
        session: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("shows the manual browser URL only when launch fallback is needed", async () => {
    const infoMessages: string[] = [];

    const result = await appSignInModule.performAppSignIn(
      {
        writeOutput: (payload) => {
          const body = payload.body;
          if (typeof body === "string") {
            infoMessages.push(body);
          }
        },
      },
      {
        readAppSessionState: () =>
          Promise.resolve(
            signedOutAppSessionState({
              path: "/tmp/app-session.json",
            }),
          ),
        randomUUID: () => generatedUuid,
        startCallbackServer: () =>
          Promise.resolve({
            callbackUrl: "http://127.0.0.1:45511/callback",
            waitForResult: () => Promise.resolve({ code: "exchange-code" }),
            close: () => Promise.resolve(),
          }),
        createLoginAttempt: () =>
          Promise.resolve({
            attemptId: "attempt-123",
            authorizeUrl: "http://localhost:3000/auth/cli?attempt=attempt-123",
            expiresAt: "2026-04-22T18:00:00.000Z",
          }),
        openExternalUrl: () => Promise.resolve(false),
        exchangeLoginCode: () => Promise.resolve(session),
        writeAppSessionState: () => Promise.resolve("/tmp/app-session.json"),
      },
    );

    expect(stripAnsi(result.body)).toBe(
      "Success: Signed in to Voratiq App as qa@example.com",
    );
    expect(infoMessages).toEqual([
      "Opening browser to sign in...",
      "Browser didn't open. Open this URL to continue:",
      "http://localhost:3000/auth/cli?attempt=attempt-123",
      "Waiting for approval in your browser...",
    ]);
  });

  it("turns browser-side cancellation into a clear CLI error", async () => {
    await expect(
      appSignInModule.performAppSignIn(
        {},
        {
          readAppSessionState: () =>
            Promise.resolve(
              signedOutAppSessionState({
                path: "/tmp/app-session.json",
              }),
            ),
          randomUUID: () => generatedUuid,
          startCallbackServer: () =>
            Promise.resolve({
              callbackUrl: "http://127.0.0.1:45511/callback",
              waitForResult: () => Promise.resolve({ code: "exchange-code" }),
              close: () => Promise.resolve(),
            }),
          createLoginAttempt: () =>
            Promise.resolve({
              attemptId: "attempt-123",
              authorizeUrl:
                "http://localhost:3000/auth/cli?attempt=attempt-123",
              expiresAt: "2026-04-22T18:00:00.000Z",
            }),
          openExternalUrl: () => Promise.resolve(false),
          exchangeLoginCode: () =>
            Promise.reject(
              new AppApiError(
                "The CLI sign-in was cancelled in the browser.",
                "cancelled_exchange",
                403,
              ),
            ),
          writeAppSessionState: () => Promise.resolve("/tmp/app-session.json"),
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        headline: "Sign-in was cancelled in the browser.",
        hintLines: ["Run `voratiq login` again when you're ready."],
      }),
    );
  });

  it("describes the Voratiq App sign-in flow in help output", () => {
    const help = createLoginCommand().helpInformation();

    expect(help).toContain("Usage: login");
    expect(help).toContain("Sign in to Voratiq App");
  });

  it("wires the login command through commander output", async () => {
    jest.spyOn(appSignInModule, "performAppSignIn").mockResolvedValueOnce({
      body: "Success: Signed in to Voratiq App as qa@example.com",
      statePath: "/Users/test/.voratiq/app-session.json",
      session,
    });

    const loginCommand = silenceCommander(createLoginCommand());
    loginCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(loginCommand);

    await program.parseAsync(["node", "voratiq", "login"]);

    expect(writeCommandOutputMock).toHaveBeenCalledWith({
      body: "Success: Signed in to Voratiq App as qa@example.com",
    });
  });

  it("exposes the login runner directly", async () => {
    jest.spyOn(appSignInModule, "performAppSignIn").mockResolvedValueOnce({
      body: "Success: Signed in to Voratiq App as qa@example.com",
      statePath: "/Users/test/.voratiq/app-session.json",
      session,
    });

    await expect(runLoginCommand()).resolves.toEqual({
      body: "Success: Signed in to Voratiq App as qa@example.com",
    });
  });
});
