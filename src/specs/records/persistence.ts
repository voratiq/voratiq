import { dirname, join } from "node:path";

import { acquireHistoryLock } from "../../runs/records/history-lock.js";
import {
  SessionOptionValidationError,
  SessionRecordMutationError,
  SessionRecordNotFoundError,
  SessionRecordParseError,
} from "../../sessions/errors.js";
import {
  createSessionPersistence,
  type SessionPersistencePaths,
  type SessionRecordWarning,
} from "../../sessions/persistence.js";
import { toErrorMessage } from "../../utils/errors.js";
import { isFileSystemError } from "../../utils/fs.js";
import {
  type SpecIndexEntry,
  type SpecRecord,
  specRecordSchema,
  type SpecRecordStatus,
  TERMINAL_SPEC_STATUSES,
} from "./types.js";

export type SpecRecordPredicate = (record: SpecRecord) => boolean;

export interface SpecRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface SpecRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type SpecRecordWarning =
  | SpecRecordWarningMissing
  | SpecRecordWarningParse;

export interface ReadSpecRecordsOptions {
  root: string;
  specsFilePath: string;
  limit?: number;
  predicate?: SpecRecordPredicate;
  onWarning?: (warning: SpecRecordWarning) => void;
}

export interface RewriteSpecRecordOptions {
  root: string;
  specsFilePath: string;
  sessionId: string;
  mutate: (record: SpecRecord) => SpecRecord;
}

export interface AppendSpecRecordOptions {
  root: string;
  specsFilePath: string;
  record: SpecRecord;
}

const SPEC_INDEX_VERSION = 1;
const SPEC_RECORD_FILENAME = "record.json";
const SPEC_HISTORY_LOCK_FILENAME = "history.lock";

const specPersistence = createSessionPersistence<
  SpecRecord,
  SpecIndexEntry,
  SpecRecordStatus
>({
  recordFilename: SPEC_RECORD_FILENAME,
  indexVersion: SPEC_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => {
    const parsed = JSON.parse(raw) as unknown;
    const result = specRecordSchema.safeParse(parsed);
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
  shouldForceFlush: (record) => TERMINAL_SPEC_STATUSES.includes(record.status),
  getRecordId: (record) => record.sessionId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const payload = parsed as { sessions?: SpecIndexEntry[] };
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  },
});

const readSpecRecordsInternal = async (
  options: ReadSpecRecordsOptions,
): Promise<SpecRecord[]> => {
  const { root, specsFilePath, limit, predicate, onWarning } = options;
  const paths = buildSpecPaths(root, specsFilePath);

  try {
    return await specPersistence.readRecords({
      paths,
      limit,
      predicate,
      onWarning: onWarning
        ? (warning) => onWarning(mapWarning(warning))
        : undefined,
    });
  } catch (error) {
    mapSessionError(error);
  }
};

export async function readSpecRecords(
  options: ReadSpecRecordsOptions,
): Promise<SpecRecord[]> {
  return readSpecRecordsInternal(options);
}

export async function appendSpecRecord(
  options: AppendSpecRecordOptions,
): Promise<void> {
  const { root, specsFilePath, record } = options;
  const paths = buildSpecPaths(root, specsFilePath);

  try {
    await specPersistence.appendRecord({ paths, record });
  } catch (error) {
    mapSessionError(error);
  }
}

export async function rewriteSpecRecord(
  options: RewriteSpecRecordOptions,
): Promise<SpecRecord> {
  const { root, specsFilePath, sessionId, mutate } = options;
  const paths = buildSpecPaths(root, specsFilePath);

  try {
    return await specPersistence.rewriteRecord({ paths, sessionId, mutate });
  } catch (error) {
    mapSessionError(error);
  }
}

export async function finalizeSpecRecord(options: {
  root: string;
  specsFilePath: string;
  sessionId: string;
  status: SpecRecordStatus;
  error?: string | null;
  completedAt?: string;
}): Promise<SpecRecord> {
  const { root, specsFilePath, sessionId, status, error, completedAt } =
    options;
  return await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (existing) => ({
      ...existing,
      status,
      error: error ?? existing.error ?? null,
      completedAt: completedAt ?? new Date().toISOString(),
    }),
  });
}

export async function flushSpecRecordBuffer(options: {
  specsFilePath: string;
  sessionId: string;
}): Promise<void> {
  const { specsFilePath, sessionId } = options;
  const paths = buildSpecPaths("", specsFilePath);

  try {
    await specPersistence.flushRecordBuffer({ paths, sessionId });
  } catch (error) {
    mapSessionError(error);
  }
}

export async function flushAllSpecRecordBuffers(): Promise<void> {
  try {
    await specPersistence.flushAllRecordBuffers();
  } catch (error) {
    mapSessionError(error);
  }
}

function buildSpecPaths(
  root: string,
  specsFilePath: string,
): SessionPersistencePaths {
  const specsRoot = dirname(specsFilePath);
  return {
    root,
    indexPath: specsFilePath,
    sessionsDir: join(specsRoot, "sessions"),
    lockPath: join(specsRoot, SPEC_HISTORY_LOCK_FILENAME),
  };
}

function mapWarning(warning: SessionRecordWarning): SpecRecordWarning {
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

  const missingWarning = warning;
  return {
    kind: "missing-record",
    sessionId: missingWarning.sessionId,
    recordPath: missingWarning.recordPath,
    displayPath: missingWarning.displayPath,
  };
}

function mapSessionError(error: unknown): never {
  if (error instanceof SessionOptionValidationError) {
    throw error;
  }
  if (error instanceof SessionRecordParseError) {
    throw error;
  }
  if (error instanceof SessionRecordNotFoundError) {
    throw error;
  }
  if (error instanceof SessionRecordMutationError) {
    throw error;
  }
  if (isFileSystemError(error)) {
    throw error;
  }
  throw new Error(toErrorMessage(error));
}
