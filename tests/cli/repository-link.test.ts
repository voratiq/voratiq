import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import type { EnsureAppRepositoryConnectionOptions } from "../../src/app-session/repository-connections.js";
import type {
  AppSessionStateSnapshot,
  RepositoryLinkStateSnapshot,
} from "../../src/app-session/state.js";
import { promptForRepositoryLinkIfNeeded } from "../../src/cli/repository-link.js";
import {
  buildAppSessionPayload,
  buildRepositoryEnsureRequest,
  buildRepositoryEnsureResponse,
  buildRepositoryLinkStateSnapshot,
  signedInAppSessionState,
  signedOutAppSessionState,
} from "../support/factories/app-session.js";

describe("repository link prompt", () => {
  it("prompts for eligible signed-in repositories and writes accepted links", async () => {
    const deps = buildDeps({ confirmValue: true });

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.confirm).toHaveBeenCalledWith({
      message: "Link this repository to Voratiq App?",
      defaultValue: true,
      prefaceLines: [""],
    });
    expect(deps.writeRepositoryLinkStateForRepoRoot.mock.calls[0]?.[0]).toEqual(
      {
        repoRoot: "/repo",
        accountId: "user-123",
        linked: true,
        env: process.env,
      },
    );
  });

  it("writes declined links", async () => {
    const deps = buildDeps({ confirmValue: false });

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.writeRepositoryLinkStateForRepoRoot.mock.calls[0]?.[0]).toEqual(
      {
        repoRoot: "/repo",
        accountId: "user-123",
        linked: false,
        env: process.env,
      },
    );
  });

  it("does not save accepted links when the app cannot confirm the backend link", async () => {
    const deps = buildDeps({ confirmValue: true });
    deps.ensureAppRepositoryConnection.mockRejectedValueOnce(
      new Error("connection conflict"),
    );

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.ensureAppRepositoryConnection).toHaveBeenCalledWith({
      env: process.env,
      payload: buildRepositoryEnsureRequest(),
    });
    expect(deps.writeRepositoryLinkStateForRepoRoot).not.toHaveBeenCalled();
    expect(deps.warn.mock.calls[0]?.[0]).toContain(
      "Repository link was not saved because Voratiq App could not confirm the link.",
    );
    expect(deps.warn.mock.calls[0]?.[0]).toContain("connection conflict");
  });

  it("persists a declined prompt decision and skips future prompts with real state", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-link-home-"),
    );
    const repoRoot = path.join(home, "repo");
    const env = {
      ...process.env,
      HOME: home,
      VORATIQ_MCP_ACK_OPERATOR: undefined,
      VORATIQ_MCP_ACK_PATH: undefined,
    };
    const confirm = jest.fn(
      (_confirmOptions: RepositoryLinkPromptConfirmOptions) => {
        void _confirmOptions;
        return Promise.resolve(false);
      },
    );

    try {
      await writeSignedInAppSession(home);

      await promptForRepositoryLinkIfNeeded({
        root: repoRoot,
        env,
        detectInteractive: () => true,
        confirm,
      });

      expect(confirm).toHaveBeenCalledTimes(1);

      await promptForRepositoryLinkIfNeeded({
        root: repoRoot,
        env,
        detectInteractive: () => true,
        confirm,
      });

      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not prompt when the repository is already linked", async () => {
    const deps = buildDeps({
      repositoryLinkState: buildRepositoryLinkStateSnapshot(true),
    });

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.writeRepositoryLinkStateForRepoRoot).not.toHaveBeenCalled();
  });

  it("does not prompt when the repository is explicitly not linked", async () => {
    const deps = buildDeps({
      repositoryLinkState: buildRepositoryLinkStateSnapshot(false),
    });

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.writeRepositoryLinkStateForRepoRoot).not.toHaveBeenCalled();
  });

  it("does not prompt when no app session exists", async () => {
    const deps = buildDeps({
      appSessionState: signedOutAppSessionState(),
    });

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.readRepositoryLinkStateForRepoRoot).not.toHaveBeenCalled();
  });

  it("does not prompt when the refresh token is expired", async () => {
    const deps = buildDeps({
      appSessionState: signedInAppSessionState({ refreshTokenExpired: true }),
    });

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.readRepositoryLinkStateForRepoRoot).not.toHaveBeenCalled();
  });

  it("does not prompt in non-interactive shells", async () => {
    const deps = buildDeps();

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      detectInteractive: () => false,
      readAppSessionState: deps.readAppSessionState,
      readRepositoryLinkStateForRepoRoot:
        deps.readRepositoryLinkStateForRepoRoot,
      writeRepositoryLinkStateForRepoRoot:
        deps.writeRepositoryLinkStateForRepoRoot,
    });

    expect(deps.readAppSessionState).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("does not prompt in json/operator-envelope mode", async () => {
    const deps = buildDeps();

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      json: true,
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.readAppSessionState).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("does not prompt during MCP-triggered operator execution", async () => {
    const deps = buildDeps();

    await promptForRepositoryLinkIfNeeded({
      root: "/repo",
      env: {
        ...process.env,
        VORATIQ_MCP_ACK_PATH: "/tmp/ack.json",
        VORATIQ_MCP_ACK_OPERATOR: "run",
      },
      detectInteractive: () => true,
      ...deps,
    });

    expect(deps.readAppSessionState).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});

function buildDeps(
  options: {
    confirmValue?: boolean;
    appSessionState?: AppSessionStateSnapshot;
    repositoryLinkState?: RepositoryLinkStateSnapshot;
  } = {},
) {
  let currentRepositoryLinkState =
    options.repositoryLinkState ?? buildRepositoryLinkStateSnapshot(null);
  const confirm = jest.fn(
    (_confirmOptions: RepositoryLinkPromptConfirmOptions) => {
      void _confirmOptions;
      return Promise.resolve(options.confirmValue ?? true);
    },
  );
  const readAppSessionState = jest.fn((_env?: NodeJS.ProcessEnv) => {
    void _env;
    return Promise.resolve(
      options.appSessionState ?? signedInAppSessionState(),
    );
  });
  const readRepositoryLinkStateForRepoRoot = jest.fn(
    (repoRoot: string, _env?: NodeJS.ProcessEnv, _accountId?: string) => {
      void _env;
      void _accountId;
      return Promise.resolve({
        ...currentRepositoryLinkState,
        repoRoot,
      });
    },
  );
  const writeRepositoryLinkStateForRepoRoot = jest.fn(
    (input: {
      repoRoot: string;
      accountId: string;
      linked: boolean;
      env?: NodeJS.ProcessEnv;
    }) => {
      currentRepositoryLinkState = buildRepositoryLinkStateSnapshot(
        input.linked,
        {
          repoRoot: input.repoRoot,
          rawOverrides: {
            accountId: input.accountId,
          },
        },
      );
      return Promise.resolve(currentRepositoryLinkState);
    },
  );
  const buildRepositoryConnectionEnsureRequest = jest.fn(
    (_repoRoot: string) => {
      void _repoRoot;
      return Promise.resolve(buildRepositoryEnsureRequest());
    },
  );
  const ensureAppRepositoryConnection = jest.fn(
    (_input: EnsureAppRepositoryConnectionOptions) => {
      void _input;
      return Promise.resolve(buildRepositoryEnsureResponse());
    },
  );
  const warn = jest.fn((_message: string) => {
    void _message;
  });

  return {
    confirm,
    readAppSessionState,
    readRepositoryLinkStateForRepoRoot,
    writeRepositoryLinkStateForRepoRoot,
    buildRepositoryConnectionEnsureRequest,
    ensureAppRepositoryConnection,
    warn,
  };
}

async function writeSignedInAppSession(home: string): Promise<void> {
  const sessionPath = path.join(home, ".voratiq", "app-session.json");
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const payload = buildAppSessionPayload({
    session: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
      refreshTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    },
    actor: {
      email: "user@example.com",
      name: "User",
      scopes: ["hosted:read"],
    },
  });

  await writeFile(sessionPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

interface RepositoryLinkPromptConfirmOptions {
  message: string;
  defaultValue: boolean;
  prefaceLines?: string[];
}
