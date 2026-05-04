import { jest } from "@jest/globals";

import { AppApiError } from "../../src/app-session/api-client.js";
import { performAppSignIn } from "../../src/app-session/login.js";
import { CliError } from "../../src/cli/errors.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import { renderCliError } from "../../src/render/utils/errors.js";
import {
  buildAppSessionPayload,
  signedOutAppSessionState,
} from "../support/factories/app-session.js";

const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function buildLoginSessionPayload() {
  return buildAppSessionPayload({
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
}

describe("voratiq login transcript", () => {
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  afterEach(() => {
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    process.exitCode = undefined;
  });

  it("renders adjacent progress lines and a blank line before success", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });

    const result = await performAppSignIn(
      {
        writeOutput: writeCommandOutput,
      },
      {
        readAppSessionState: () =>
          Promise.resolve(
            signedOutAppSessionState({ path: "/tmp/app-session.json" }),
          ),
        randomUUID: () => "00000000-0000-4000-8000-000000000000",
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
        openExternalUrl: () => Promise.resolve(true),
        exchangeLoginCode: () => Promise.resolve(buildLoginSessionPayload()),
        writeAppSessionState: () => Promise.resolve("/tmp/app-session.json"),
      },
    );

    writeCommandOutput({ body: result.body });

    expect(stripAnsi(stdout.join(""))).toBe(
      [
        "",
        "Opening browser to sign in...",
        "Waiting for approval in your browser...",
        "",
        "Success: Signed in to Voratiq App as qa@example.com",
        "",
        "",
      ].join("\n"),
    );
    expect(stderr.join("")).toHaveLength(0);
  });

  it("separates the manual browser URL fallback from the waiting phase", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });

    const result = await performAppSignIn(
      {
        writeOutput: writeCommandOutput,
      },
      {
        readAppSessionState: () =>
          Promise.resolve(
            signedOutAppSessionState({ path: "/tmp/app-session.json" }),
          ),
        randomUUID: () => "00000000-0000-4000-8000-000000000000",
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
        exchangeLoginCode: () => Promise.resolve(buildLoginSessionPayload()),
        writeAppSessionState: () => Promise.resolve("/tmp/app-session.json"),
      },
    );

    writeCommandOutput({ body: result.body });

    expect(stripAnsi(stdout.join(""))).toBe(
      [
        "",
        "Opening browser to sign in...",
        "Browser didn't open. Open this URL to continue:",
        "http://localhost:3000/auth/cli?attempt=attempt-123",
        "",
        "Waiting for approval in your browser...",
        "",
        "Success: Signed in to Voratiq App as qa@example.com",
        "",
        "",
      ].join("\n"),
    );
    expect(stderr.join("")).toHaveLength(0);
  });

  it("keeps the cancellation transcript aligned with the design doc", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });

    let capturedError: CliError | undefined;

    try {
      await performAppSignIn(
        {
          writeOutput: writeCommandOutput,
        },
        {
          readAppSessionState: () =>
            Promise.resolve(
              signedOutAppSessionState({ path: "/tmp/app-session.json" }),
            ),
          randomUUID: () => "00000000-0000-4000-8000-000000000000",
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
          exchangeLoginCode: () =>
            Promise.reject(
              new AppApiError(
                "The CLI sign-in was cancelled in the browser.",
                "cancelled_exchange",
                403,
              ),
            ),
        },
      );
    } catch (error) {
      capturedError = error as CliError;
    }

    if (!capturedError) {
      throw new Error("Expected login cancellation to throw.");
    }

    writeCommandOutput({
      body: renderCliError(capturedError),
      exitCode: 1,
    });

    expect(stripAnsi(stdout.join(""))).toBe(
      [
        "",
        "Opening browser to sign in...",
        "Waiting for approval in your browser...",
        "",
        "Error: Sign-in was cancelled in the browser.",
        "",
        "Run `voratiq login` again when you're ready.",
        "",
        "",
      ].join("\n"),
    );
    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });
});
