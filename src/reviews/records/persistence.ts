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
import type { ReviewIndexEntry, ReviewRecord, ReviewStatus } from "./types.js";
import { reviewRecordSchema, TERMINAL_REVIEW_STATUSES } from "./types.js";

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

const reviewPersistence = createSessionPersistence<
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
    mapSessionError(error);
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
    mapSessionError(error);
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
    mapSessionError(error);
  }
}

export async function finalizeReviewRecord(options: {
  root: string;
  reviewsFilePath: string;
  sessionId: string;
  status: ReviewStatus;
  error?: string | null;
  completedAt?: string;
}): Promise<ReviewRecord> {
  const { root, reviewsFilePath, sessionId, status, error, completedAt } =
    options;
  return await rewriteReviewRecord({
    root,
    reviewsFilePath,
    sessionId,
    mutate: (existing) => {
      const finalizedAt = completedAt ?? new Date().toISOString();
      const sessionError = error ?? existing.error ?? null;
      const reviewers =
        status === "running"
          ? existing.reviewers
          : existing.reviewers.map((reviewer) => {
              if (reviewer.status !== "running") {
                return reviewer;
              }
              if (status === "succeeded") {
                return {
                  ...reviewer,
                  status: "succeeded" as const,
                  completedAt: reviewer.completedAt ?? finalizedAt,
                  error: null,
                };
              }
              return {
                ...reviewer,
                status,
                completedAt: reviewer.completedAt ?? finalizedAt,
                error: reviewer.error ?? sessionError,
              };
            });

      return {
        ...existing,
        status,
        error: sessionError,
        completedAt: finalizedAt,
        reviewers,
      };
    },
  });
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
    mapSessionError(error);
  }
}

export async function flushAllReviewRecordBuffers(): Promise<void> {
  try {
    await reviewPersistence.flushAllRecordBuffers();
  } catch (error) {
    mapSessionError(error);
  }
}

function buildReviewPaths(
  root: string,
  reviewsFilePath: string,
): SessionPersistencePaths {
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
