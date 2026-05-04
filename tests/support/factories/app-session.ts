import type {
  AppRepositoryConnectionEnsureRequest,
  AppRepositoryConnectionEnsureResponse,
} from "../../../src/app-session/repository-connections.js";
import type { AppSessionPayload } from "../../../src/app-session/session.js";
import type {
  AppSessionStateSnapshot,
  RepositoryLinkStateSnapshot,
} from "../../../src/app-session/state.js";

interface AppSessionPayloadOverrides extends Partial<
  AppSessionPayload["session"]
> {
  version?: AppSessionPayload["version"];
  installation?: Partial<AppSessionPayload["installation"]>;
  session?: Partial<AppSessionPayload["session"]>;
  actor?: Partial<AppSessionPayload["actor"]>;
}

interface RepositoryLinkStateSnapshotOverrides extends Partial<RepositoryLinkStateSnapshot> {
  rawOverrides?: Partial<NonNullable<RepositoryLinkStateSnapshot["raw"]>>;
}

export function buildAppSessionPayload(
  overrides: AppSessionPayloadOverrides = {},
): AppSessionPayload {
  const { version, installation, session, actor, ...sessionOverrides } =
    overrides;

  return {
    version: version ?? 1,
    installation: {
      id: "install-123",
      ...installation,
    },
    session: {
      kind: "machine",
      id: "session-123",
      accessToken: "access-token-old",
      refreshToken: "refresh-token-old",
      accessTokenExpiresAt: "2026-04-24T02:00:00.000Z",
      refreshTokenExpiresAt: "2026-04-25T02:00:00.000Z",
      ...sessionOverrides,
      ...session,
    },
    actor: {
      id: "user-123",
      email: "qa@example.com",
      name: "QA",
      role: "user",
      flags: [],
      scopes: ["hosted:read"],
      ...actor,
    },
  };
}

export function buildAppSessionStateSnapshot(
  raw: AppSessionPayload | null = buildAppSessionPayload(),
  overrides: Partial<AppSessionStateSnapshot> = {},
): AppSessionStateSnapshot {
  return {
    path: "/Users/test/.voratiq/app-session.json",
    exists: raw !== null,
    user: raw
      ? {
          id: raw.actor.id,
          email: raw.actor.email,
          name: raw.actor.name,
        }
      : null,
    accessTokenExpiresAt: raw?.session.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: raw?.session.refreshTokenExpiresAt ?? null,
    accessTokenExpired: null,
    refreshTokenExpired: null,
    raw,
    ...overrides,
  };
}

export function signedOutAppSessionState(
  overrides: Partial<AppSessionStateSnapshot> = {},
): AppSessionStateSnapshot {
  return buildAppSessionStateSnapshot(null, overrides);
}

export function signedInAppSessionState(
  overrides: Partial<AppSessionStateSnapshot> = {},
): AppSessionStateSnapshot {
  const userOverride = overrides.user;
  const raw =
    "raw" in overrides
      ? (overrides.raw ?? null)
      : buildAppSessionPayload({
          session: {
            accessTokenExpiresAt:
              overrides.accessTokenExpiresAt ?? "2026-05-01T00:00:00.000Z",
            refreshTokenExpiresAt:
              overrides.refreshTokenExpiresAt ?? "2026-05-01T00:00:00.000Z",
          },
          actor: {
            id: userOverride?.id ?? "user-123",
            email: userOverride?.email ?? "user@example.com",
            name: userOverride?.name ?? "User",
          },
        });

  return buildAppSessionStateSnapshot(raw, {
    accessTokenExpired: false,
    refreshTokenExpired: false,
    ...overrides,
    raw,
    user: raw
      ? {
          id: raw.actor.id,
          email: raw.actor.email,
          name: raw.actor.name,
        }
      : overrides.user,
    exists: raw !== null,
    accessTokenExpiresAt:
      raw?.session.accessTokenExpiresAt ??
      overrides.accessTokenExpiresAt ??
      null,
    refreshTokenExpiresAt:
      raw?.session.refreshTokenExpiresAt ??
      overrides.refreshTokenExpiresAt ??
      null,
  });
}

export function buildRepositoryLinkStateSnapshot(
  linked: boolean | null = true,
  overrides: RepositoryLinkStateSnapshotOverrides = {},
): RepositoryLinkStateSnapshot {
  const { rawOverrides, ...snapshotOverrides } = overrides;
  const repoRoot = overrides.repoRoot ?? "/repo";
  const raw: RepositoryLinkStateSnapshot["raw"] =
    "raw" in snapshotOverrides
      ? (snapshotOverrides.raw ?? null)
      : linked === null
        ? null
        : {
            repoRoot,
            accountId: "user-123",
            linked,
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            ...rawOverrides,
          };

  return {
    repoRoot,
    path: "/Users/test/.voratiq/repositories.json",
    exists: linked !== null,
    linked,
    raw,
    ...snapshotOverrides,
  };
}

export function buildRepositoryEnsureRequest(
  overrides: Partial<AppRepositoryConnectionEnsureRequest> = {},
): AppRepositoryConnectionEnsureRequest {
  return {
    local_repo_key: "repo-local-key",
    slug: "voratiq",
    ...overrides,
  };
}

export function buildRepositoryEnsureResponse(
  overrides: Partial<AppRepositoryConnectionEnsureResponse> = {},
): AppRepositoryConnectionEnsureResponse {
  return {
    repository_id: "repository-123",
    repository_connection_id: "connection-123",
    linked: true,
    created_repository: false,
    created_connection: false,
    ...overrides,
  };
}
