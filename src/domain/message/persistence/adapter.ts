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
  MessageIndexEntry,
  MessageRecord,
  MessageStatus,
} from "../model/types.js";
import {
  messageRecordSchema,
  TERMINAL_MESSAGE_STATUSES,
} from "../model/types.js";

export type MessageRecordPredicate = (record: MessageRecord) => boolean;

export interface MessageRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface MessageRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type MessageRecordWarning =
  | MessageRecordWarningMissing
  | MessageRecordWarningParse;

export interface ReadMessageRecordsOptions {
  root: string;
  messagesFilePath: string;
  limit?: number;
  predicate?: MessageRecordPredicate;
  onWarning?: (warning: MessageRecordWarning) => void;
}

export interface RewriteMessageRecordOptions {
  root: string;
  messagesFilePath: string;
  sessionId: string;
  mutate: (record: MessageRecord) => MessageRecord;
  forceFlush?: boolean;
}

export interface AppendMessageRecordOptions {
  root: string;
  messagesFilePath: string;
  record: MessageRecord;
}

const MESSAGE_INDEX_VERSION = 1;
const MESSAGE_RECORD_FILENAME = "record.json";
const MESSAGE_HISTORY_LOCK_FILENAME = "history.lock";

const messagePersistence = createSessionStore<
  MessageRecord,
  MessageIndexEntry,
  MessageStatus
>({
  recordFilename: MESSAGE_RECORD_FILENAME,
  indexVersion: MESSAGE_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => {
    const parsed = JSON.parse(raw) as unknown;
    const result = messageRecordSchema.safeParse(parsed);
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
    TERMINAL_MESSAGE_STATUSES.includes(record.status),
  getRecordId: (record) => record.sessionId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const payload = parsed as { sessions?: MessageIndexEntry[] };
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  },
});

export async function readMessageRecords(
  options: ReadMessageRecordsOptions,
): Promise<MessageRecord[]> {
  const { root, messagesFilePath, limit, predicate, onWarning } = options;
  const paths = buildMessagePaths(root, messagesFilePath);

  try {
    return await messagePersistence.readRecords({
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

export async function appendMessageRecord(
  options: AppendMessageRecordOptions,
): Promise<void> {
  const { root, messagesFilePath, record } = options;
  const paths = buildMessagePaths(root, messagesFilePath);

  try {
    await messagePersistence.appendRecord({ paths, record });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function rewriteMessageRecord(
  options: RewriteMessageRecordOptions,
): Promise<MessageRecord> {
  const {
    root,
    messagesFilePath,
    sessionId,
    mutate,
    forceFlush = false,
  } = options;
  const paths = buildMessagePaths(root, messagesFilePath);

  try {
    return await messagePersistence.rewriteRecord({
      paths,
      sessionId,
      mutate,
      forceFlush,
    });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushMessageRecordBuffer(options: {
  messagesFilePath: string;
  sessionId: string;
}): Promise<void> {
  const { messagesFilePath, sessionId } = options;
  const paths = buildMessagePaths("", messagesFilePath);

  try {
    await messagePersistence.flushRecordBuffer({ paths, sessionId });
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

export async function flushAllMessageRecordBuffers(): Promise<void> {
  try {
    await messagePersistence.flushAllRecordBuffers();
  } catch (error) {
    throw mapSessionStoreError(error, sessionStoreErrorMapper);
  }
}

function buildMessagePaths(
  root: string,
  messagesFilePath: string,
): SessionStorePaths {
  const messagesRoot = dirname(messagesFilePath);
  return {
    root,
    indexPath: messagesFilePath,
    sessionsDir: join(messagesRoot, "sessions"),
    lockPath: join(messagesRoot, MESSAGE_HISTORY_LOCK_FILENAME),
  };
}

function mapWarning(warning: SessionRecordWarning): MessageRecordWarning {
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
