import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { jest } from "@jest/globals";

import {
  readAppSessionState,
  readRepositoryLinkState,
  writeRepositoryLinkStateForRepoRoot,
} from "../../src/app-session/state.js";
import { getGitRepositoryRoot } from "../../src/utils/git.js";

jest.mock("../../src/utils/git.js", () => {
  const actual = jest.requireActual<typeof import("../../src/utils/git.js")>(
    "../../src/utils/git.js",
  );
  return {
    ...actual,
    getGitRepositoryRoot: jest.fn(),
  };
});

const getGitRepositoryRootMock = jest.mocked(getGitRepositoryRoot);

async function writeJsonFile(pathname: string, value: Record<string, unknown>) {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("Voratiq App state files", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("reads global app session state from app-session.json", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-app-session-home-"),
    );

    try {
      await writeJsonFile(path.join(home, ".voratiq", "app-session.json"), {
        version: 1,
        installation: {
          id: "install-123",
        },
        session: {
          kind: "machine",
          id: "session-123",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
          refreshTokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
        actor: {
          id: "user_app",
          email: "app@example.com",
          name: null,
          role: "user",
          flags: [],
          scopes: ["hosted:read"],
        },
      });

      const state = await readAppSessionState({ ...process.env, HOME: home });

      expect(state.path).toBe(path.join(home, ".voratiq", "app-session.json"));
      expect(state.exists).toBe(true);
      expect(state.user?.email).toBe("app@example.com");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reads repository link state from repositories.json", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-link-repo-"),
    );
    getGitRepositoryRootMock.mockResolvedValue(repoRoot);

    try {
      await writeJsonFile(path.join(home, ".voratiq", "repositories.json"), {
        version: 1,
        repositories: [
          {
            repoRoot,
            accountId: "primary-user",
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      const state = await readRepositoryLinkState(
        repoRoot,
        {
          ...process.env,
          HOME: home,
        },
        "primary-user",
      );

      expect(state).toMatchObject({
        repoRoot,
        path: path.join(home, ".voratiq", "repositories.json"),
        exists: true,
        linked: true,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("reads linked false entries as explicit declined links", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-link-repo-"),
    );
    getGitRepositoryRootMock.mockResolvedValue(repoRoot);

    try {
      await writeJsonFile(path.join(home, ".voratiq", "repositories.json"), {
        version: 1,
        repositories: [
          {
            repoRoot,
            accountId: "primary-user",
            linked: false,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      const state = await readRepositoryLinkState(
        repoRoot,
        {
          ...process.env,
          HOME: home,
        },
        "primary-user",
      );

      expect(state).toMatchObject({
        repoRoot,
        path: path.join(home, ".voratiq", "repositories.json"),
        exists: true,
        linked: false,
        raw: {
          repoRoot,
          accountId: "primary-user",
          linked: false,
          createdAt: "2026-04-23T22:10:00.000Z",
          updatedAt: "2026-04-23T22:10:00.000Z",
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("reads repository link state for the active account only", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-link-repo-"),
    );
    getGitRepositoryRootMock.mockResolvedValue(repoRoot);

    try {
      await writeJsonFile(path.join(home, ".voratiq", "repositories.json"), {
        version: 1,
        repositories: [
          {
            repoRoot,
            accountId: "secondary-user",
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
          {
            repoRoot,
            accountId: "primary-user",
            linked: false,
            createdAt: "2026-04-24T22:10:00.000Z",
            updatedAt: "2026-04-24T22:10:00.000Z",
          },
        ],
      });

      const state = await readRepositoryLinkState(
        repoRoot,
        {
          ...process.env,
          HOME: home,
        },
        "primary-user",
      );

      expect(state).toMatchObject({
        repoRoot,
        path: path.join(home, ".voratiq", "repositories.json"),
        exists: true,
        linked: false,
        raw: {
          repoRoot,
          accountId: "primary-user",
          linked: false,
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects repository link entries without account ids", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-link-repo-"),
    );
    getGitRepositoryRootMock.mockResolvedValue(repoRoot);

    try {
      await writeJsonFile(path.join(home, ".voratiq", "repositories.json"), {
        version: 1,
        repositories: [
          {
            repoRoot,
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      await expect(
        readRepositoryLinkState(
          repoRoot,
          {
            ...process.env,
            HOME: home,
          },
          "primary-user",
        ),
      ).rejects.toMatchObject({
        name: "AppSessionStateReadError",
        reason: "invalid",
        scope: "repository",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("treats repository link state as unknown when the entry is missing", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-link-repo-"),
    );
    getGitRepositoryRootMock.mockResolvedValue(repoRoot);

    try {
      await writeJsonFile(path.join(home, ".voratiq", "repositories.json"), {
        version: 1,
        repositories: [
          {
            repoRoot: "/tmp/other-repo",
            accountId: "primary-user",
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      const state = await readRepositoryLinkState(
        repoRoot,
        {
          ...process.env,
          HOME: home,
        },
        "primary-user",
      );

      expect(state).toMatchObject({
        repoRoot,
        path: path.join(home, ".voratiq", "repositories.json"),
        exists: false,
        linked: null,
        raw: null,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("writes a new repository link entry", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );

    try {
      const snapshot = await writeRepositoryLinkStateForRepoRoot({
        repoRoot: "/tmp/repo-a",
        accountId: "primary-user",
        linked: true,
        env: { ...process.env, HOME: home },
        now: new Date("2026-04-23T22:10:00.000Z"),
      });

      expect(snapshot).toMatchObject({
        repoRoot: "/tmp/repo-a",
        path: path.join(home, ".voratiq", "repositories.json"),
        exists: true,
        linked: true,
        raw: {
          repoRoot: "/tmp/repo-a",
          accountId: "primary-user",
          linked: true,
          createdAt: "2026-04-23T22:10:00.000Z",
          updatedAt: "2026-04-23T22:10:00.000Z",
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("updates an existing repository link entry", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );

    try {
      await writeJsonFile(path.join(home, ".voratiq", "repositories.json"), {
        version: 1,
        repositories: [
          {
            repoRoot: "/tmp/repo-a",
            accountId: "primary-user",
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      const snapshot = await writeRepositoryLinkStateForRepoRoot({
        repoRoot: "/tmp/repo-a",
        accountId: "primary-user",
        linked: false,
        env: { ...process.env, HOME: home },
        now: new Date("2026-04-24T01:00:00.000Z"),
      });

      expect(snapshot).toMatchObject({
        repoRoot: "/tmp/repo-a",
        path: path.join(home, ".voratiq", "repositories.json"),
        exists: true,
        linked: false,
        raw: {
          repoRoot: "/tmp/repo-a",
          accountId: "primary-user",
          linked: false,
          createdAt: "2026-04-23T22:10:00.000Z",
          updatedAt: "2026-04-24T01:00:00.000Z",
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("writes account-scoped repository links without overwriting other accounts", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const registryPath = path.join(home, ".voratiq", "repositories.json");

    try {
      await writeJsonFile(registryPath, {
        version: 1,
        repositories: [
          {
            repoRoot: "/tmp/repo-a",
            accountId: "secondary-user",
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      const snapshot = await writeRepositoryLinkStateForRepoRoot({
        repoRoot: "/tmp/repo-a",
        accountId: "primary-user",
        linked: false,
        env: { ...process.env, HOME: home },
        now: new Date("2026-04-24T01:00:00.000Z"),
      });

      const payload = JSON.parse(await readFile(registryPath, "utf8")) as {
        repositories: Array<Record<string, unknown>>;
      };

      expect(snapshot).toMatchObject({
        repoRoot: "/tmp/repo-a",
        path: registryPath,
        exists: true,
        linked: false,
        raw: {
          repoRoot: "/tmp/repo-a",
          accountId: "primary-user",
          linked: false,
          createdAt: "2026-04-24T01:00:00.000Z",
          updatedAt: "2026-04-24T01:00:00.000Z",
        },
      });
      expect(payload.repositories).toHaveLength(2);
      expect(payload.repositories[0]).toMatchObject({
        repoRoot: "/tmp/repo-a",
        accountId: "secondary-user",
        linked: true,
      });
      expect(payload.repositories[1]).toMatchObject({
        repoRoot: "/tmp/repo-a",
        accountId: "primary-user",
        linked: false,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("preserves linked false entries on rewrite", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "voratiq-repository-registry-home-"),
    );
    const registryPath = path.join(home, ".voratiq", "repositories.json");

    try {
      await writeJsonFile(registryPath, {
        version: 1,
        repositories: [
          {
            repoRoot: "/tmp/repo-a",
            accountId: "secondary-user",
            linked: false,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
          {
            repoRoot: "/tmp/repo-b",
            accountId: "primary-user",
            linked: true,
            createdAt: "2026-04-23T22:10:00.000Z",
            updatedAt: "2026-04-23T22:10:00.000Z",
          },
        ],
      });

      await writeRepositoryLinkStateForRepoRoot({
        repoRoot: "/tmp/repo-b",
        accountId: "primary-user",
        linked: true,
        env: { ...process.env, HOME: home },
        now: new Date("2026-04-24T01:00:00.000Z"),
      });

      const payload = JSON.parse(await readFile(registryPath, "utf8")) as {
        repositories: Array<{ repoRoot: string; linked: boolean }>;
      };

      expect(payload.repositories).toHaveLength(2);
      expect(payload.repositories[0]).toMatchObject({
        repoRoot: "/tmp/repo-a",
        linked: false,
      });
      expect(payload.repositories[1]).toMatchObject({
        repoRoot: "/tmp/repo-b",
        linked: true,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
