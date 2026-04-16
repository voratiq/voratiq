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
import { buildRecordLifecycleCompleteFields } from "../../shared/lifecycle.js";
import {
  type SpecAgentEntry,
  type SpecIndexEntry,
  type SpecRecord,
  specRecordSchema,
  type SpecRecordStatus,
  TERMINAL_SPEC_STATUSES,
} from "../model/types.js";

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
  forceFlush?: boolean;
}

export interface AppendSpecRecordOptions {
  root: string;
  specsFilePath: string;
  record: SpecRecord;
}

const SPEC_INDEX_VERSION = 1;
const SPEC_RECORD_FILENAME = "record.json";
const SPEC_HISTORY_LOCK_FILENAME = "history.lock";

const specPersistence = createSessionStore<
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
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
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
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function rewriteSpecRecord(
  options: RewriteSpecRecordOptions,
): Promise<SpecRecord> {
  const { root, specsFilePath, sessionId, mutate, forceFlush } = options;
  const paths = buildSpecPaths(root, specsFilePath);

  try {
    return await specPersistence.rewriteRecord({
      paths,
      sessionId,
      mutate,
      forceFlush,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function finalizeSpecRecord(options: {
  root: string;
  specsFilePath: string;
  sessionId: string;
  status: SpecRecordStatus;
  agents?: readonly SpecAgentEntry[];
  error?: string | null;
  completedAt?: string;
}): Promise<SpecRecord> {
  const { root, specsFilePath, sessionId, status, agents, error, completedAt } =
    options;
  return await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (existing) => ({
      ...existing,
      status,
      ...buildRecordLifecycleCompleteFields({ existing, completedAt }),
      ...(agents ? { agents: [...agents] } : {}),
      error: error ?? existing.error ?? null,
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
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushAllSpecRecordBuffers(): Promise<void> {
  try {
    await specPersistence.flushAllRecordBuffers();
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

function buildSpecPaths(
  root: string,
  specsFilePath: string,
): SessionStorePaths {
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
