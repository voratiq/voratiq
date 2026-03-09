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
  ReviewIndexEntry,
  ReviewRecord,
  ReviewStatus,
} from "../model/types.js";
import {
  reviewRecordSchema,
  TERMINAL_REVIEW_STATUSES,
} from "../model/types.js";

export type ReviewRecordPredicate = (record: ReviewRecord) => boolean;

export interface ReviewRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface ReviewRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type ReviewRecordWarning =
  | ReviewRecordWarningMissing
  | ReviewRecordWarningParse;

export interface ReadReviewRecordsOptions {
  root: string;
  reviewsFilePath: string;
  limit?: number;
  predicate?: ReviewRecordPredicate;
  onWarning?: (warning: ReviewRecordWarning) => void;
}

export interface RewriteReviewRecordOptions {
  root: string;
  reviewsFilePath: string;
  sessionId: string;
  mutate: (record: ReviewRecord) => ReviewRecord;
  forceFlush?: boolean;
}

export interface AppendReviewRecordOptions {
  root: string;
  reviewsFilePath: string;
  record: ReviewRecord;
}

const REVIEW_INDEX_VERSION = 1;
const REVIEW_RECORD_FILENAME = "record.json";
const REVIEW_HISTORY_LOCK_FILENAME = "history.lock";

const reviewPersistence = createSessionStore<
  ReviewRecord,
  ReviewIndexEntry,
  ReviewStatus
>({
  recordFilename: REVIEW_RECORD_FILENAME,
  indexVersion: REVIEW_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => {
    const parsed = JSON.parse(raw) as unknown;
    const result = reviewRecordSchema.safeParse(parsed);
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
    TERMINAL_REVIEW_STATUSES.includes(record.status),
  getRecordId: (record) => record.sessionId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const payload = parsed as { sessions?: ReviewIndexEntry[] };
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  },
});

export async function readReviewRecords(
  options: ReadReviewRecordsOptions,
): Promise<ReviewRecord[]> {
  const { root, reviewsFilePath, limit, predicate, onWarning } = options;
  const paths = buildReviewPaths(root, reviewsFilePath);

  try {
    return await reviewPersistence.readRecords({
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

export async function appendReviewRecord(
  options: AppendReviewRecordOptions,
): Promise<void> {
  const { root, reviewsFilePath, record } = options;
  const paths = buildReviewPaths(root, reviewsFilePath);

  try {
    await reviewPersistence.appendRecord({ paths, record });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function rewriteReviewRecord(
  options: RewriteReviewRecordOptions,
): Promise<ReviewRecord> {
  const {
    root,
    reviewsFilePath,
    sessionId,
    mutate,
    forceFlush = false,
  } = options;
  const paths = buildReviewPaths(root, reviewsFilePath);

  try {
    return await reviewPersistence.rewriteRecord({
      paths,
      sessionId,
      mutate,
      forceFlush,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushReviewRecordBuffer(options: {
  reviewsFilePath: string;
  sessionId: string;
}): Promise<void> {
  const { reviewsFilePath, sessionId } = options;
  const paths = buildReviewPaths("", reviewsFilePath);

  try {
    await reviewPersistence.flushRecordBuffer({ paths, sessionId });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushAllReviewRecordBuffers(): Promise<void> {
  try {
    await reviewPersistence.flushAllRecordBuffers();
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

function buildReviewPaths(
  root: string,
  reviewsFilePath: string,
): SessionStorePaths {
  const reviewsRoot = dirname(reviewsFilePath);
  return {
    root,
    indexPath: reviewsFilePath,
    sessionsDir: join(reviewsRoot, "sessions"),
    lockPath: join(reviewsRoot, REVIEW_HISTORY_LOCK_FILENAME),
  };
}

function mapWarning(warning: SessionRecordWarning): ReviewRecordWarning {
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
