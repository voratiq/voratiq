import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isMissing, pathExists } from "../utils/fs.js";
import { getGitRepositoryRoot } from "../utils/git.js";
import type { AppSessionPayload } from "./session.js";
import {
  resolveAppSessionStatePath,
  resolveRepositoryRegistryStatePath,
} from "./state-path.js";

export interface AppSessionUser {
  id: string | null;
  email: string | null;
  name: string | null;
}

export interface AppSessionStateSnapshot {
  path: string;
  exists: boolean;
  user: AppSessionUser | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  accessTokenExpired: boolean | null;
  refreshTokenExpired: boolean | null;
  raw: AppSessionPayload | null;
}

export interface RepositoryLinkStateSnapshot {
  repoRoot: string;
  path: string;
  exists: boolean;
  linked: boolean | null;
  raw: RepositoryRegistryEntry | null;
}

export interface RepositoryRegistryEntry {
  repoRoot: string;
  accountId: string;
  linked: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RepositoryRegistryPayload {
  version: 1;
  repositories: RepositoryRegistryEntry[];
}

export type AppSessionStateReadScope = "global" | "repository";
export type AppSessionStateReadReason = "invalid" | "unreadable";

export class AppSessionStateReadError extends Error {
  readonly scope: AppSessionStateReadScope;
  readonly path: string;
  readonly reason: AppSessionStateReadReason;

  constructor(options: {
    scope: AppSessionStateReadScope;
    path: string;
    reason: AppSessionStateReadReason;
    cause?: unknown;
  }) {
    super(buildAppSessionStateReadErrorMessage(options), {
      cause: options.cause,
    });
    this.name = "AppSessionStateReadError";
    this.scope = options.scope;
    this.path = options.path;
    this.reason = options.reason;
  }
}

export async function readAppSessionState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppSessionStateSnapshot> {
  const path = resolveAppSessionStatePath(env);
  const raw = await readAppSessionStateAtPath(path, "global");

  return {
    path,
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
    accessTokenExpired: raw
      ? isExpiredTimestamp(raw.session.accessTokenExpiresAt)
      : null,
    refreshTokenExpired: raw
      ? isExpiredTimestamp(raw.session.refreshTokenExpiresAt)
      : null,
    raw,
  };
}

export async function readRepositoryLinkState(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  accountId: string,
): Promise<RepositoryLinkStateSnapshot | null> {
  const repoRoot = await getGitRepositoryRoot(cwd);
  if (!repoRoot) {
    return null;
  }

  return await readRepositoryLinkStateForRepoRoot(repoRoot, env, accountId);
}

export async function readRepositoryLinkStateForRepoRoot(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  accountId: string,
): Promise<RepositoryLinkStateSnapshot> {
  const path = resolveRepositoryRegistryStatePath(env);
  const raw = await readRepositoryRegistryAtPath(path, "repository");
  const match =
    raw?.repositories.find((entry) =>
      repositoryRegistryEntryMatches(entry, repoRoot, accountId),
    ) ?? null;

  return {
    repoRoot,
    path,
    exists: match !== null,
    linked: match ? match.linked : null,
    raw: match,
  };
}

export async function writeRepositoryLinkStateForRepoRoot(options: {
  repoRoot: string;
  accountId: string;
  linked: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<RepositoryLinkStateSnapshot> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const path = resolveRepositoryRegistryStatePath(env);
  const existing = await readRepositoryRegistryAtPath(path, "repository");
  const repositories = existing
    ? [...existing.repositories]
    : ([] as RepositoryRegistryEntry[]);
  const index = repositories.findIndex((entry) =>
    repositoryRegistryEntryMatches(entry, options.repoRoot, options.accountId),
  );

  if (index >= 0) {
    const current = repositories[index];
    repositories[index] = {
      repoRoot: current.repoRoot,
      accountId: current.accountId,
      linked: options.linked,
      createdAt: current.createdAt,
      updatedAt: timestamp,
    };
  } else {
    repositories.push({
      repoRoot: options.repoRoot,
      accountId: options.accountId,
      linked: options.linked,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const payload: RepositoryRegistryPayload = {
    version: 1,
    repositories,
  };

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);

  return await readRepositoryLinkStateForRepoRoot(
    options.repoRoot,
    env,
    options.accountId,
  );
}

function repositoryRegistryEntryMatches(
  entry: RepositoryRegistryEntry,
  repoRoot: string,
  accountId: string,
) {
  return entry.repoRoot === repoRoot && entry.accountId === accountId;
}

async function readAppSessionStateAtPath(
  path: string,
  scope: AppSessionStateReadScope,
): Promise<AppSessionPayload | null> {
  try {
    const parsed = await readJsonObjectFile(path);
    if (parsed === null) {
      return null;
    }
    return parseAppSessionPayload(parsed, path);
  } catch (error) {
    throw new AppSessionStateReadError({
      scope,
      path,
      reason:
        error instanceof AppSessionStateFileFormatError
          ? "invalid"
          : "unreadable",
      cause: error,
    });
  }
}

async function readRepositoryRegistryAtPath(
  path: string,
  scope: AppSessionStateReadScope,
): Promise<RepositoryRegistryPayload | null> {
  try {
    const parsed = await readJsonObjectFile(path);
    if (parsed === null) {
      return null;
    }
    return parseRepositoryRegistryPayload(parsed, path);
  } catch (error) {
    throw new AppSessionStateReadError({
      scope,
      path,
      reason:
        error instanceof AppSessionStateFileFormatError
          ? "invalid"
          : "unreadable",
      cause: error,
    });
  }
}

async function readJsonObjectFile(
  path: string,
): Promise<Record<string, unknown> | null> {
  if (!(await pathExists(path))) {
    return null;
  }

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new AppSessionStateFileFormatError(
      "invalid_json",
      `Voratiq App state file is empty: ${path}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new AppSessionStateFileFormatError(
      "invalid_json",
      `Invalid JSON in Voratiq App state file: ${path}`,
      {
        cause: error,
      },
    );
  }

  if (!isRecord(parsed)) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Voratiq App state file must contain a JSON object: ${path}`,
    );
  }

  return parsed;
}

class AppSessionStateFileFormatError extends Error {
  readonly code: "invalid_json" | "invalid_object";

  constructor(
    code: "invalid_json" | "invalid_object",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppSessionStateFileFormatError";
    this.code = code;
  }
}

function buildAppSessionStateReadErrorMessage(options: {
  scope: AppSessionStateReadScope;
  path: string;
  reason: AppSessionStateReadReason;
}): string {
  const subject =
    options.scope === "global"
      ? "saved Voratiq App sign-in state"
      : "Voratiq App repository link registry";
  const problem = options.reason === "invalid" ? "invalid" : "unreadable";
  return `The ${subject} at ${options.path} is ${problem}.`;
}

function parseAppSessionPayload(
  raw: Record<string, unknown>,
  path: string,
): AppSessionPayload {
  assertExactKeys(raw, path, ["version", "installation", "session", "actor"]);

  const installation = readRecord(raw.installation, path, "installation");
  assertExactKeys(installation, path, ["id"], "installation");

  const session = readRecord(raw.session, path, "session");
  assertExactKeys(
    session,
    path,
    [
      "kind",
      "id",
      "accessToken",
      "refreshToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
    ],
    "session",
  );

  const actor = readRecord(raw.actor, path, "actor");
  assertExactKeys(
    actor,
    path,
    ["id", "email", "name", "role", "flags", "scopes"],
    "actor",
  );

  return {
    version: readVersion(raw.version, path),
    installation: {
      id: readNonEmptyString(installation.id, path, "installation.id"),
    },
    session: {
      kind: readNonEmptyString(session.kind, path, "session.kind"),
      id: readNonEmptyString(session.id, path, "session.id"),
      accessToken: readNonEmptyString(
        session.accessToken,
        path,
        "session.accessToken",
      ),
      refreshToken: readNonEmptyString(
        session.refreshToken,
        path,
        "session.refreshToken",
      ),
      accessTokenExpiresAt: readTimestampString(
        session.accessTokenExpiresAt,
        path,
        "session.accessTokenExpiresAt",
      ),
      refreshTokenExpiresAt: readTimestampString(
        session.refreshTokenExpiresAt,
        path,
        "session.refreshTokenExpiresAt",
      ),
    },
    actor: {
      id: readNonEmptyString(actor.id, path, "actor.id"),
      email: readNullableString(actor.email, path, "actor.email"),
      name: readNullableString(actor.name, path, "actor.name"),
      role: readNonEmptyString(actor.role, path, "actor.role"),
      flags: readStringArray(actor.flags, path, "actor.flags"),
      scopes: readStringArray(actor.scopes, path, "actor.scopes"),
    },
  };
}

export function parseAppSessionPayloadFromUnknown(
  raw: unknown,
  source: string,
): AppSessionPayload {
  if (!isRecord(raw)) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Voratiq App session payload must be a JSON object: ${source}`,
    );
  }
  return parseAppSessionPayload(raw, source);
}

function parseRepositoryRegistryPayload(
  raw: Record<string, unknown>,
  path: string,
): RepositoryRegistryPayload {
  assertExactKeys(raw, path, ["version", "repositories"]);
  const repositories = readArray(raw.repositories, path, "repositories");

  return {
    version: readVersion(raw.version, path),
    repositories: repositories.map((entry, index) =>
      parseRepositoryRegistryEntry(entry, path, `repositories[${index}]`),
    ),
  };
}

function parseRepositoryRegistryEntry(
  value: unknown,
  path: string,
  field: string,
): RepositoryRegistryEntry {
  const entry = readRecord(value, path, field);
  assertExactKeys(
    entry,
    path,
    ["repoRoot", "accountId", "linked", "createdAt", "updatedAt"],
    field,
  );

  const linked = readBoolean(entry.linked, path, `${field}.linked`);
  const repoRoot = readNonEmptyString(
    entry.repoRoot,
    path,
    `${field}.repoRoot`,
  );
  const accountId = readNonEmptyString(
    entry.accountId,
    path,
    `${field}.accountId`,
  );
  const createdAt = readTimestampString(
    entry.createdAt,
    path,
    `${field}.createdAt`,
  );
  const updatedAt = readTimestampString(
    entry.updatedAt,
    path,
    `${field}.updatedAt`,
  );

  return {
    repoRoot,
    accountId,
    linked,
    createdAt,
    updatedAt,
  };
}

function assertExactKeys(
  value: Record<string, unknown>,
  path: string,
  expectedKeys: string[],
  prefix?: string,
) {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (expected.has(key)) {
      continue;
    }
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Unexpected field ${formatField(prefix ? `${prefix}.${key}` : key)} in Voratiq App state file: ${path}`,
    );
  }
}

function readRecord(
  value: unknown,
  path: string,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be an object in Voratiq App state file: ${path}`,
    );
  }
  return value;
}

function readArray(value: unknown, path: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be an array in Voratiq App state file: ${path}`,
    );
  }

  return value;
}

function readVersion(value: unknown, path: string): 1 {
  if (value !== 1) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField("version")} to equal 1 in Voratiq App state file: ${path}`,
    );
  }
  return 1;
}

function readBoolean(value: unknown, path: string, field: string) {
  if (typeof value !== "boolean") {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be a boolean in Voratiq App state file: ${path}`,
    );
  }
  return value;
}

function readNonEmptyString(value: unknown, path: string, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be a non-empty string in Voratiq App state file: ${path}`,
    );
  }
  return value;
}

function readNullableString(value: unknown, path: string, field: string) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be a string or null in Voratiq App state file: ${path}`,
    );
  }
  return value;
}

function readStringArray(value: unknown, path: string, field: string) {
  if (!Array.isArray(value)) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be a string array in Voratiq App state file: ${path}`,
    );
  }

  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new AppSessionStateFileFormatError(
        "invalid_object",
        `Expected ${formatField(field)} to be a string array in Voratiq App state file: ${path}`,
      );
    }
    entries.push(entry);
  }

  return entries;
}

function readTimestampString(value: unknown, path: string, field: string) {
  const candidate = readNonEmptyString(value, path, field);
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new AppSessionStateFileFormatError(
      "invalid_object",
      `Expected ${formatField(field)} to be an ISO timestamp in Voratiq App state file: ${path}`,
    );
  }
  return candidate;
}

function isExpiredTimestamp(value: string) {
  return Date.parse(value) <= Date.now();
}

function formatField(field: string) {
  return `\`${field}\``;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
