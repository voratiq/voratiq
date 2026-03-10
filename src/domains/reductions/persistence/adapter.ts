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
  ReductionIndexEntry,
  ReductionRecord,
  ReductionStatus,
} from "../model/types.js";
import {
  reductionRecordSchema,
  TERMINAL_REDUCTION_STATUSES,
} from "../model/types.js";

export type ReductionRecordPredicate = (record: ReductionRecord) => boolean;

export interface ReductionRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface ReductionRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type ReductionRecordWarning =
  | ReductionRecordWarningMissing
  | ReductionRecordWarningParse;

export interface ReadReductionRecordsOptions {
  root: string;
  reductionsFilePath: string;
  limit?: number;
  predicate?: ReductionRecordPredicate;
  onWarning?: (warning: ReductionRecordWarning) => void;
}

export interface RewriteReductionRecordOptions {
  root: string;
  reductionsFilePath: string;
  sessionId: string;
  mutate: (record: ReductionRecord) => ReductionRecord;
  forceFlush?: boolean;
}

export interface AppendReductionRecordOptions {
  root: string;
  reductionsFilePath: string;
  record: ReductionRecord;
}

const REDUCTION_INDEX_VERSION = 1;
const REDUCTION_RECORD_FILENAME = "record.json";
const REDUCTION_HISTORY_LOCK_FILENAME = "history.lock";

const reductionPersistence = createSessionStore<
  ReductionRecord,
  ReductionIndexEntry,
  ReductionStatus
>({
  recordFilename: REDUCTION_RECORD_FILENAME,
  indexVersion: REDUCTION_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => {
    const parsed = JSON.parse(raw) as unknown;
    const result = reductionRecordSchema.safeParse(parsed);
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
  }),
  getIndexEntryId: (entry) => entry.sessionId,
  shouldForceFlush: (record) =>
    TERMINAL_REDUCTION_STATUSES.includes(record.status),
  getRecordId: (record) => record.sessionId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const payload = parsed as { sessions?: ReductionIndexEntry[] };
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  },
});

export async function readReductionRecords(
  options: ReadReductionRecordsOptions,
): Promise<ReductionRecord[]> {
  const { root, reductionsFilePath, limit, predicate, onWarning } = options;
  const paths = buildReductionPaths(root, reductionsFilePath);

  try {
    return await reductionPersistence.readRecords({
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

export async function appendReductionRecord(
  options: AppendReductionRecordOptions,
): Promise<void> {
  const { root, reductionsFilePath, record } = options;
  const paths = buildReductionPaths(root, reductionsFilePath);

  try {
    await reductionPersistence.appendRecord({ paths, record });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function rewriteReductionRecord(
  options: RewriteReductionRecordOptions,
): Promise<ReductionRecord> {
  const {
    root,
    reductionsFilePath,
    sessionId,
    mutate,
    forceFlush = false,
  } = options;
  const paths = buildReductionPaths(root, reductionsFilePath);

  try {
    return await reductionPersistence.rewriteRecord({
      paths,
      sessionId,
      mutate,
      forceFlush,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushReductionRecordBuffer(options: {
  reductionsFilePath: string;
  sessionId: string;
}): Promise<void> {
  const { reductionsFilePath, sessionId } = options;
  const paths = buildReductionPaths("", reductionsFilePath);

  try {
    await reductionPersistence.flushRecordBuffer({ paths, sessionId });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushAllReductionRecordBuffers(): Promise<void> {
  try {
    await reductionPersistence.flushAllRecordBuffers();
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

function buildReductionPaths(
  root: string,
  reductionsFilePath: string,
): SessionStorePaths {
  const reductionsRoot = dirname(reductionsFilePath);
  return {
    root,
    indexPath: reductionsFilePath,
    sessionsDir: join(reductionsRoot, "sessions"),
    lockPath: join(reductionsRoot, REDUCTION_HISTORY_LOCK_FILENAME),
  };
}

function mapWarning(warning: SessionRecordWarning): ReductionRecordWarning {
  if (warning.kind === "parse-error") {
    const parseWarning = warning;
    return {
      kind: "parse-error",
      sessionId: parseWarning.sessionId,
      recordPath: parseWarning.recordPath,
      displayPath: parseWarning.displayPath,
      details: parseWarning.details,
    };
  }

  const missing = warning;
  return {
    kind: "missing-record",
    sessionId: missing.sessionId,
    recordPath: missing.recordPath,
    displayPath: missing.displayPath,
  };
}
