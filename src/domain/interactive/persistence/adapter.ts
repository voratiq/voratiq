import { mkdir } from "node:fs/promises";
import { relative as relativePath } from "node:path";

import {
  mapSessionStoreError,
  sessionStoreErrorMapper,
} from "../../../persistence/error-mapping.js";
import { SessionRecordParseError } from "../../../persistence/errors.js";
import { acquireHistoryLock } from "../../../persistence/history-lock.js";
import {
  createSessionStore,
  type SessionRecordWarning,
  type SessionStorePaths,
} from "../../../persistence/session-store.js";
import { assertRepoRelativePath, resolvePath } from "../../../utils/path.js";
import {
  getInteractiveHistoryLockPath,
  getInteractiveIndexPath,
  getInteractiveSessionArtifactsDirectoryPath,
  getInteractiveSessionDirectoryPath,
  getInteractiveSessionRecordPath,
  getInteractiveSessionsDirectoryPath,
} from "../../../workspace/session-paths.js";
import {
  buildLifecycleStartFields,
  buildRecordLifecycleCompleteFields,
} from "../../shared/lifecycle.js";
import type {
  InteractiveSessionIndexEntry,
  InteractiveSessionRecord,
  InteractiveSessionStatus,
} from "../model/types.js";
import {
  interactiveSessionIndexRecordSchema,
  interactiveSessionRecordSchema,
} from "../model/types.js";

const INTERACTIVE_INDEX_VERSION = 1 as const;

export interface InteractiveSessionPaths {
  indexPath: string;
  sessionRoot: string;
  recordPath: string;
  artifactsPath: string;
  runtimePath: string;
}

export type InteractiveRecordPredicate = (
  record: InteractiveSessionRecord,
) => boolean;

export interface InteractiveRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface InteractiveRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type InteractiveRecordWarning =
  | InteractiveRecordWarningMissing
  | InteractiveRecordWarningParse;

export interface ReadInteractiveRecordsOptions {
  root: string;
  interactiveFilePath: string;
  limit?: number;
  predicate?: InteractiveRecordPredicate;
  onWarning?: (warning: InteractiveRecordWarning) => void;
}

const interactivePersistence = createSessionStore<
  InteractiveSessionRecord,
  InteractiveSessionIndexEntry,
  InteractiveSessionStatus
>({
  recordFilename: "record.json",
  indexVersion: INTERACTIVE_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => parseInteractiveRecord(path, raw),
  buildIndexEntry: (record) => ({
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    status: record.status,
  }),
  getIndexEntryId: (entry) => entry.sessionId,
  shouldForceFlush: (record) => record.status !== "running",
  getRecordId: (record) => record.sessionId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const result = interactiveSessionIndexRecordSchema.safeParse(parsed);
    return result.success ? result.data.sessions : [];
  },
});

export function resolveInteractiveSessionPaths(
  root: string,
  sessionId: string,
): InteractiveSessionPaths {
  return {
    indexPath: resolvePath(root, getInteractiveIndexPath()),
    sessionRoot: resolvePath(
      root,
      getInteractiveSessionDirectoryPath(sessionId),
    ),
    recordPath: resolvePath(root, getInteractiveSessionRecordPath(sessionId)),
    artifactsPath: resolvePath(
      root,
      getInteractiveSessionArtifactsDirectoryPath(sessionId),
    ),
    runtimePath: resolvePath(
      root,
      getInteractiveSessionDirectoryPath(sessionId),
      "runtime",
    ),
  };
}

export async function readInteractiveRecords(
  options: ReadInteractiveRecordsOptions,
): Promise<InteractiveSessionRecord[]> {
  const { root, interactiveFilePath, limit, predicate, onWarning } = options;
  const paths = buildInteractivePaths(root, interactiveFilePath);

  try {
    return await interactivePersistence.readRecords({
      paths,
      limit,
      predicate,
      onWarning: onWarning
        ? (warning) => onWarning(mapWarning(warning))
        : undefined,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function ensureInteractiveSessionDirectories(options: {
  sessionRoot: string;
  artifactsPath: string;
  runtimePath: string;
}): Promise<void> {
  const { sessionRoot, artifactsPath, runtimePath } = options;
  await Promise.all([
    mkdir(sessionRoot, { recursive: true }),
    mkdir(artifactsPath, { recursive: true }),
    mkdir(runtimePath, { recursive: true }),
  ]);
}

export async function appendInteractiveSessionRecord(options: {
  root: string;
  record: InteractiveSessionRecord;
}): Promise<void> {
  const { root, record } = options;
  const paths = buildInteractiveSessionStorePaths(root);
  try {
    await interactivePersistence.appendRecord({ paths, record });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function rewriteInteractiveSessionRecord(options: {
  root: string;
  sessionId: string;
  mutate: (record: InteractiveSessionRecord) => InteractiveSessionRecord;
  forceFlush?: boolean;
}): Promise<InteractiveSessionRecord> {
  const { root, sessionId, mutate, forceFlush = true } = options;
  const paths = buildInteractiveSessionStorePaths(root);
  try {
    return await interactivePersistence.rewriteRecord({
      paths,
      sessionId,
      mutate,
      forceFlush,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function updateInteractiveSessionStatus(options: {
  root: string;
  sessionId: string;
  status: InteractiveSessionStatus;
}): Promise<InteractiveSessionRecord> {
  const { root, sessionId, status } = options;
  return await rewriteInteractiveSessionRecord({
    root,
    sessionId,
    mutate: (record) => {
      const timestamp = new Date().toISOString();
      if (status === "running") {
        return {
          ...record,
          status,
          ...buildLifecycleStartFields({
            existingStartedAt: record.startedAt,
            timestamp,
          }),
          completedAt: undefined,
        };
      }

      return {
        ...record,
        status,
        ...buildRecordLifecycleCompleteFields({
          existing: record,
          startedAt: record.startedAt ?? record.createdAt,
          completedAt: timestamp,
        }),
      };
    },
    forceFlush: true,
  });
}

export async function getInteractiveSessionRecordSnapshot(options: {
  root: string;
  sessionId: string;
}): Promise<InteractiveSessionRecord | undefined> {
  const paths = buildInteractiveSessionStorePaths(options.root);
  try {
    return await interactivePersistence.getRecordSnapshot({
      paths,
      sessionId: options.sessionId,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushAllInteractiveSessionBuffers(): Promise<void> {
  try {
    await interactivePersistence.flushAllRecordBuffers();
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function disposeInteractiveSessionBuffer(options: {
  root: string;
  sessionId: string;
}): Promise<void> {
  const paths = buildInteractiveSessionStorePaths(options.root);
  try {
    await interactivePersistence.disposeRecordBuffer({
      paths,
      sessionId: options.sessionId,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export function toInteractiveSessionRelativePath(
  root: string,
  absolutePath: string | undefined,
): string | undefined {
  if (!absolutePath) {
    return undefined;
  }
  const relative = relativePath(root, absolutePath).replaceAll("\\", "/");
  return assertRepoRelativePath(relative);
}

function buildInteractiveSessionStorePaths(root: string): SessionStorePaths {
  return {
    root,
    indexPath: resolvePath(root, getInteractiveIndexPath()),
    sessionsDir: resolvePath(root, getInteractiveSessionsDirectoryPath()),
    lockPath: resolvePath(root, getInteractiveHistoryLockPath()),
  };
}

function buildInteractivePaths(
  root: string,
  interactiveFilePath: string,
): SessionStorePaths {
  return {
    root,
    indexPath: interactiveFilePath,
    sessionsDir: resolvePath(root, getInteractiveSessionsDirectoryPath()),
    lockPath: resolvePath(root, getInteractiveHistoryLockPath()),
  };
}

function mapWarning(warning: SessionRecordWarning): InteractiveRecordWarning {
  if (warning.kind === "parse-error") {
    return {
      kind: "parse-error",
      sessionId: warning.sessionId,
      recordPath: warning.recordPath,
      displayPath: warning.displayPath,
      details: warning.details,
    };
  }

  return {
    kind: "missing-record",
    sessionId: warning.sessionId,
    recordPath: warning.recordPath,
    displayPath: warning.displayPath,
  };
}

function parseInteractiveRecord(
  path: string,
  raw: string,
): InteractiveSessionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new SessionRecordParseError(
      path,
      error instanceof Error ? error.message : "Invalid JSON",
    );
  }

  const result = interactiveSessionRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new SessionRecordParseError(
      path,
      result.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  return result.data;
}
