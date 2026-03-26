import { dirname, join } from "node:path";

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
import type {
  VerificationIndexEntry,
  VerificationRecord,
  VerificationStatus,
} from "../model/types.js";
import {
  TERMINAL_VERIFICATION_STATUSES,
  verificationRecordSchema,
} from "../model/types.js";

export type VerificationRecordPredicate = (
  record: VerificationRecord,
) => boolean;

export interface VerificationRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface VerificationRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type VerificationRecordWarning =
  | VerificationRecordWarningMissing
  | VerificationRecordWarningParse;

export interface ReadVerificationRecordsOptions {
  root: string;
  verificationsFilePath: string;
  limit?: number;
  predicate?: VerificationRecordPredicate;
  onWarning?: (warning: VerificationRecordWarning) => void;
}

export interface RewriteVerificationRecordOptions {
  root: string;
  verificationsFilePath: string;
  sessionId: string;
  mutate: (record: VerificationRecord) => VerificationRecord;
  forceFlush?: boolean;
}

export interface AppendVerificationRecordOptions {
  root: string;
  verificationsFilePath: string;
  record: VerificationRecord;
}

const VERIFICATION_INDEX_VERSION = 1;
const VERIFICATION_RECORD_FILENAME = "record.json";
const VERIFICATION_HISTORY_LOCK_FILENAME = "history.lock";

const verificationPersistence = createSessionStore<
  VerificationRecord,
  VerificationIndexEntry,
  VerificationStatus
>({
  recordFilename: VERIFICATION_RECORD_FILENAME,
  indexVersion: VERIFICATION_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => {
    const parsed = JSON.parse(raw) as unknown;
    const result = verificationRecordSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => issue.message)
        .join(", ");
      throw new SessionRecordParseError(path, issues);
    }
    return result.data;
  },
  buildIndexEntry: (record) => ({
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    status: record.status,
    targetKind: record.target.kind,
    targetSessionId: record.target.sessionId,
  }),
  getIndexEntryId: (entry) => entry.sessionId,
  shouldForceFlush: (record) =>
    TERMINAL_VERIFICATION_STATUSES.includes(record.status),
  getRecordId: (record) => record.sessionId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const payload = parsed as { sessions?: VerificationIndexEntry[] };
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  },
});

export async function readVerificationRecords(
  options: ReadVerificationRecordsOptions,
): Promise<VerificationRecord[]> {
  const { root, verificationsFilePath, limit, predicate, onWarning } = options;
  const paths = buildVerificationPaths(root, verificationsFilePath);

  try {
    return await verificationPersistence.readRecords({
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

export async function appendVerificationRecord(
  options: AppendVerificationRecordOptions,
): Promise<void> {
  const { root, verificationsFilePath, record } = options;
  const paths = buildVerificationPaths(root, verificationsFilePath);

  try {
    await verificationPersistence.appendRecord({ paths, record });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function rewriteVerificationRecord(
  options: RewriteVerificationRecordOptions,
): Promise<VerificationRecord> {
  const {
    root,
    verificationsFilePath,
    sessionId,
    mutate,
    forceFlush = false,
  } = options;
  const paths = buildVerificationPaths(root, verificationsFilePath);

  try {
    return await verificationPersistence.rewriteRecord({
      paths,
      sessionId,
      mutate,
      forceFlush,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushVerificationRecordBuffer(options: {
  verificationsFilePath: string;
  sessionId: string;
}): Promise<void> {
  const { verificationsFilePath, sessionId } = options;
  const paths = buildVerificationPaths("", verificationsFilePath);

  try {
    await verificationPersistence.flushRecordBuffer({ paths, sessionId });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushAllVerificationRecordBuffers(): Promise<void> {
  try {
    await verificationPersistence.flushAllRecordBuffers();
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

function buildVerificationPaths(
  root: string,
  verificationsFilePath: string,
): SessionStorePaths {
  const verificationsRoot = dirname(verificationsFilePath);
  return {
    root,
    indexPath: verificationsFilePath,
    sessionsDir: join(verificationsRoot, "sessions"),
    lockPath: join(verificationsRoot, VERIFICATION_HISTORY_LOCK_FILENAME),
  };
}

function mapWarning(warning: SessionRecordWarning): VerificationRecordWarning {
  if (warning.kind === "missing-record") {
    return {
      kind: "missing-record",
      sessionId: warning.sessionId,
      recordPath: warning.recordPath,
      displayPath: warning.displayPath,
    };
  }

  return {
    kind: "parse-error",
    sessionId: warning.sessionId,
    recordPath: warning.recordPath,
    displayPath: warning.displayPath,
    details: warning.details,
  };
}
