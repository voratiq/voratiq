import { Command } from "commander";

import {
  AppSessionStateReadError,
  type AppSessionStateSnapshot,
  readAppSessionState,
  readRepositoryLinkState,
} from "../../src/app-session/state.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import { createStatusCommand, runStatusCommand } from "../../src/cli/status.js";
import { silenceCommander } from "../support/commander.js";
import {
  buildRepositoryLinkStateSnapshot,
  signedInAppSessionState,
  signedOutAppSessionState,
} from "../support/factories/app-session.js";

jest.mock("../../src/app-session/state.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/app-session/state.js")
  >("../../src/app-session/state.js");
  return {
    ...actual,
    readAppSessionState: jest.fn(),
    readRepositoryLinkState: jest.fn(),
  };
});

jest.mock("../../src/cli/output.js", () => ({
  writeCommandOutput: jest.fn(),
}));

const readAppSessionStateMock = jest.mocked(readAppSessionState);
const readRepositoryLinkStateMock = jest.mocked(readRepositoryLinkState);
const writeCommandOutputMock = jest.mocked(writeCommandOutput);

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  const ansiPattern = new RegExp(`${esc}\\[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
}

function expectSuccessJson(
  result: Awaited<ReturnType<typeof runStatusCommand>>,
) {
  if ("error" in result.json) {
    throw new Error("Expected success json output.");
  }

  return result.json;
}

function buildStatusAppSessionState(
  overrides: Partial<AppSessionStateSnapshot> = {},
): AppSessionStateSnapshot {
  return signedInAppSessionState({
    user: {
      id: "user_123",
      email: "qa@example.com",
      name: "QA",
    },
    accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
    refreshTokenExpiresAt: "2026-06-01T12:00:00.000Z",
    ...overrides,
  });
}

describe("voratiq status", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    readAppSessionStateMock.mockResolvedValue(buildStatusAppSessionState());
    readRepositoryLinkStateMock.mockResolvedValue(
      buildRepositoryLinkStateSnapshot(true, {
        rawOverrides: {
          accountId: "user_123",
          createdAt: "2026-04-23T22:10:00.000Z",
          updatedAt: "2026-04-23T22:10:00.000Z",
        },
      }),
    );
  });

  it("renders the signed-in repository-active status view", async () => {
    const result = await runStatusCommand();

    expect(result.json).toEqual({
      global: {
        path: "/Users/test/.voratiq/app-session.json",
        signedIn: true,
        user: {
          id: "user_123",
          email: "qa@example.com",
          name: "QA",
        },
        accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
        refreshTokenExpiresAt: "2026-06-01T12:00:00.000Z",
        accessTokenExpired: false,
        refreshTokenExpired: false,
      },
      repository: {
        repoRoot: "/repo",
        path: "/Users/test/.voratiq/repositories.json",
        exists: true,
        linked: true,
        accountId: "user_123",
      },
      effective: {
        linked: true,
        reason: "linked",
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      [
        "Signed in to Voratiq App as qa@example.com",
        "",
        "This repository is linked to Voratiq App.",
      ].join("\n"),
    );
  });

  it("renders repository link state as off when the repo is not linked", async () => {
    readRepositoryLinkStateMock.mockResolvedValue(
      buildRepositoryLinkStateSnapshot(false, { raw: null }),
    );

    const result = await runStatusCommand();
    const json = expectSuccessJson(result);

    expect(json.effective).toEqual({
      linked: false,
      reason: "not_linked",
    });
    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      [
        "Signed in to Voratiq App as qa@example.com",
        "",
        "This repository is not linked to Voratiq App.",
      ].join("\n"),
    );
  });

  it("renders repository link state as unknown when no entry is stored", async () => {
    readRepositoryLinkStateMock.mockResolvedValue(
      buildRepositoryLinkStateSnapshot(null),
    );

    const result = await runStatusCommand();
    const json = expectSuccessJson(result);

    expect(json.effective).toEqual({
      linked: false,
      reason: "not_linked",
    });
    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      [
        "Signed in to Voratiq App as qa@example.com",
        "",
        "This repository is not linked to Voratiq App.",
      ].join("\n"),
    );
  });

  it("treats signed-out state as neutral", async () => {
    readAppSessionStateMock.mockResolvedValue(signedOutAppSessionState());
    readRepositoryLinkStateMock.mockResolvedValue(null);

    const result = await runStatusCommand();
    const json = expectSuccessJson(result);

    expect(json.effective).toEqual({
      linked: false,
      reason: "not_signed_in",
    });
    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      [
        "Not signed in to Voratiq App.",
        "",
        "Run `voratiq login` to sign in and link repositories.",
      ].join("\n"),
    );
  });

  it("shows the outside-repository link message", async () => {
    readRepositoryLinkStateMock.mockResolvedValue(null);

    const result = await runStatusCommand();
    const json = expectSuccessJson(result);

    expect(json.effective).toEqual({
      linked: false,
      reason: "not_linked",
    });
    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      [
        "Signed in to Voratiq App as qa@example.com",
        "",
        "Run this inside a repository to see its link status.",
      ].join("\n"),
    );
  });

  it("does not perform a network session refresh check", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await runStatusCommand();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("shows expired sign-in as an expected state", async () => {
    readAppSessionStateMock.mockResolvedValue(
      buildStatusAppSessionState({
        accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
        refreshTokenExpiresAt: "2026-05-02T12:00:00.000Z",
        accessTokenExpired: true,
        refreshTokenExpired: true,
      }),
    );
    readRepositoryLinkStateMock.mockResolvedValue(null);

    const result = await runStatusCommand();
    const json = expectSuccessJson(result);

    expect(json.effective).toEqual({
      linked: false,
      reason: "session_expired",
    });
    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      ["Sign-in expired.", "", "Run `voratiq login` again."].join("\n"),
    );
  });

  it("shows refreshable sign-in state without re-login wording", async () => {
    readAppSessionStateMock.mockResolvedValue(
      buildStatusAppSessionState({
        accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
        refreshTokenExpiresAt: "2026-06-01T12:00:00.000Z",
        accessTokenExpired: true,
        refreshTokenExpired: false,
      }),
    );

    const result = await runStatusCommand();

    expect(result.exitCode).toBe(0);
    expect(result.body).toBe(
      [
        "Signed in to Voratiq App as qa@example.com",
        "",
        "This repository is linked to Voratiq App.",
      ].join("\n"),
    );
    expect(result.body).not.toContain("Run `voratiq login` again.");
  });

  it("renders a CLI error when saved app sign-in state is unreadable", async () => {
    readAppSessionStateMock.mockRejectedValue(
      new AppSessionStateReadError({
        scope: "global",
        path: "/Users/test/.voratiq/app-session.json",
        reason: "invalid",
      }),
    );

    const result = await runStatusCommand();

    expect(result.exitCode).toBe(1);
    expect(stripAnsi(result.body)).toBe(
      [
        "Error: Could not read Voratiq App sign-in state.",
        "",
        "Fix or remove `app-session.json`, then run `voratiq login` again.",
      ].join("\n"),
    );
    expect(result.json).toEqual({
      error: {
        code: "global_state_unreadable",
        scope: "global",
        reason: "invalid",
        path: "/Users/test/.voratiq/app-session.json",
        headline: "Could not read Voratiq App sign-in state.",
        hint: "Fix or remove `app-session.json`, then run `voratiq login` again.",
      },
    });
  });

  it("renders a repository link-settings error with signed-in context", async () => {
    readRepositoryLinkStateMock.mockRejectedValue(
      new AppSessionStateReadError({
        scope: "repository",
        path: "/Users/test/.voratiq/repositories.json",
        reason: "invalid",
      }),
    );

    const result = await runStatusCommand();

    expect(result.exitCode).toBe(1);
    expect(stripAnsi(result.body)).toBe(
      [
        "Signed in to Voratiq App as qa@example.com",
        "",
        "Error: Could not read repository link state.",
        "",
        "Fix or remove `repositories.json`, then run `voratiq status` again.",
      ].join("\n"),
    );
    expect(result.json).toEqual({
      error: {
        code: "repository_link_state_unreadable",
        scope: "repository",
        reason: "invalid",
        path: "/Users/test/.voratiq/repositories.json",
        headline: "Could not read repository link state.",
        hint: "Fix or remove `repositories.json`, then run `voratiq status` again.",
      },
    });
  });

  it("does not remap unrelated global status failures to saved-state guidance", async () => {
    readAppSessionStateMock.mockRejectedValue(new Error("boom"));

    await expect(runStatusCommand()).rejects.toThrow("boom");
  });

  it("emits structured json on status errors", async () => {
    readAppSessionStateMock.mockRejectedValue(
      new AppSessionStateReadError({
        scope: "global",
        path: "/Users/test/.voratiq/app-session.json",
        reason: "invalid",
      }),
    );

    const statusCommand = silenceCommander(createStatusCommand());
    statusCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(statusCommand);

    await program.parseAsync(["node", "voratiq", "status", "--json"]);

    expect(writeCommandOutputMock).toHaveBeenCalledWith({
      body: JSON.stringify(
        {
          error: {
            code: "global_state_unreadable",
            scope: "global",
            reason: "invalid",
            path: "/Users/test/.voratiq/app-session.json",
            headline: "Could not read Voratiq App sign-in state.",
            hint: "Fix or remove `app-session.json`, then run `voratiq login` again.",
          },
        },
        null,
        2,
      ),
      exitCode: 1,
    });
  });

  it("describes Voratiq App sign-in and repository link status in help output", () => {
    const help = createStatusCommand().helpInformation();

    expect(help).toContain("Usage: status [options]");
    expect(help).toContain(
      "Show Voratiq App sign-in and repository link status",
    );
    expect(help).toContain("--json");
  });

  it("emits machine-readable output with --json", async () => {
    const statusCommand = silenceCommander(createStatusCommand());
    statusCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(statusCommand);

    await program.parseAsync(["node", "voratiq", "status", "--json"]);

    expect(writeCommandOutputMock).toHaveBeenCalledWith({
      body: JSON.stringify(
        {
          global: {
            path: "/Users/test/.voratiq/app-session.json",
            signedIn: true,
            user: {
              id: "user_123",
              email: "qa@example.com",
              name: "QA",
            },
            accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
            refreshTokenExpiresAt: "2026-06-01T12:00:00.000Z",
            accessTokenExpired: false,
            refreshTokenExpired: false,
          },
          repository: {
            repoRoot: "/repo",
            path: "/Users/test/.voratiq/repositories.json",
            exists: true,
            linked: true,
            accountId: "user_123",
          },
          effective: {
            linked: true,
            reason: "linked",
          },
        },
        null,
        2,
      ),
    });
  });
});
