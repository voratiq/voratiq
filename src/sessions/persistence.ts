import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isFileSystemError, pathExists } from "../utils/fs.js";
import { relativeToRoot } from "../utils/path.js";
import {
  SessionOptionValidationError,
  SessionRecordMutationError,
  SessionRecordNotFoundError,
  SessionRecordParseError,
} from "./errors.js";

export interface SessionPersistencePaths {
  root: string;
  indexPath: string;
  sessionsDir: string;
  lockPath: string;
}

export interface SessionRecordWarningMissing {
  kind: "missing-record";
  sessionId: string;
  recordPath: string;
  displayPath: string;
}

export interface SessionRecordWarningParse {
  kind: "parse-error";
  sessionId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type SessionRecordWarning =
  | SessionRecordWarningMissing
  | SessionRecordWarningParse;

export interface ReadSessionRecordsOptions<RecordType> {
  paths: SessionPersistencePaths;
  limit?: number;
  predicate?: (record: RecordType) => boolean;
  onWarning?: (warning: SessionRecordWarning) => void;
}

export interface AppendSessionRecordOptions<RecordType> {
  paths: SessionPersistencePaths;
  record: RecordType;
}

export interface RewriteSessionRecordOptions<RecordType> {
  paths: SessionPersistencePaths;
  sessionId: string;
  mutate: (record: RecordType) => RecordType;
}

export interface SessionIndexPayload<Entry> {
  version: number;
  sessions: Entry[];
}

export type SessionRecordBufferSnapshotEntry = {
  key: string;
  sessionId: string;
  hasFlushTimer: boolean;
};

export interface SessionPersistenceConfig<RecordType, IndexEntry, StatusType> {
  recordFilename: string;
  indexVersion: number;
  acquireLock: (lockPath: string) => Promise<() => Promise<void>>;
  parseRecord: (input: { path: string; raw: string }) => RecordType;
  serializeRecord?: (record: RecordType) => string;
  buildIndexEntry: (record: RecordType) => IndexEntry;
  getIndexEntryId: (entry: IndexEntry) => string;
  mergeIndexEntry?: (existing: IndexEntry, incoming: IndexEntry) => IndexEntry;
  shouldForceFlush: (record: RecordType) => boolean;
  getRecordId: (record: RecordType) => string;
  getRecordStatus: (record: RecordType) => StatusType;
  readIndexEntries?: (parsed: unknown) => IndexEntry[];
  buildIndexPayload?: (entries: IndexEntry[], version: number) => unknown;
  extractIdFromRecordPath?: (path: string) => string;
}

interface SessionRecordBufferEntry<RecordType, StatusType> {
  key: string;
  sessionId: string;
  recordPath: string;
  lockPath: string;
  sessionsDir: string;
  indexPath: string;
  root: string;
  record: RecordType;
  lastPersistedStatus: StatusType;
  dirty: boolean;
  flushTimer?: NodeJS.Timeout;
  flushPromise?: Promise<void>;
}

const BUFFER_FLUSH_DELAY_MS = 250;

export function createSessionPersistence<RecordType, IndexEntry, StatusType>(
  config: SessionPersistenceConfig<RecordType, IndexEntry, StatusType>,
) {
  const buffer = new Map<
    string,
    SessionRecordBufferEntry<RecordType, StatusType>
  >();

  let readRecordsImpl = readRecordsInternal;

  function setReadRecordsImplementation(
    implementation: typeof readRecordsInternal,
  ): void {
    readRecordsImpl = implementation;
  }

  function resetReadRecordsImplementation(): void {
    readRecordsImpl = readRecordsInternal;
  }

  async function readRecordsInternal(
    options: ReadSessionRecordsOptions<RecordType>,
  ): Promise<RecordType[]> {
    const { paths, limit, predicate, onWarning } = options;

    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new SessionOptionValidationError(
        "limit",
        "must be a positive integer",
      );
    }

    let index: SessionIndexPayload<IndexEntry>;
    try {
      index = await readIndex(paths.indexPath);
    } catch (error) {
      if (error instanceof SessionRecordParseError) {
        const displayPath = relativeToRoot(paths.root, paths.indexPath);
        throw new SessionRecordParseError(displayPath, error.details);
      }
      throw error;
    }

    const matches: RecordType[] = [];

    for (let i = index.sessions.length - 1; i >= 0; i -= 1) {
      const entry = index.sessions[i];
      if (!entry) {
        continue;
      }
      const sessionId = config.getIndexEntryId(entry);
      const recordPath = join(
        paths.sessionsDir,
        sessionId,
        config.recordFilename,
      );
      try {
        const record = await readRecordFromDisk(recordPath);
        if (predicate && !predicate(record)) {
          continue;
        }
        matches.push(record);
        if (limit !== undefined && matches.length >= limit) {
          break;
        }
      } catch (error) {
        if (error instanceof SessionRecordParseError) {
          const warning: SessionRecordWarningParse = {
            kind: "parse-error",
            sessionId,
            recordPath,
            displayPath: relativeToRoot(paths.root, recordPath),
            details: error.details,
          };
          onWarning?.(warning);
          continue;
        }
        if (error instanceof SessionRecordNotFoundError) {
          const warning: SessionRecordWarningMissing = {
            kind: "missing-record",
            sessionId,
            recordPath,
            displayPath: relativeToRoot(paths.root, recordPath),
          };
          onWarning?.(warning);
          continue;
        }
        throw error;
      }
    }

    return matches;
  }

  async function readRecords(
    options: ReadSessionRecordsOptions<RecordType>,
  ): Promise<RecordType[]> {
    return readRecordsImpl(options);
  }

  async function appendRecord(
    options: AppendSessionRecordOptions<RecordType>,
  ): Promise<void> {
    const { paths, record } = options;
    const sessionId = config.getRecordId(record);
    const recordDir = join(paths.sessionsDir, sessionId);
    const recordPath = join(recordDir, config.recordFilename);
    const displayPath = relativeToRoot(paths.root, recordPath);

    await mkdir(recordDir, { recursive: true });
    const releaseLock = await config.acquireLock(paths.lockPath);

    try {
      if (await pathExists(recordPath)) {
        throw new SessionRecordMutationError(
          `Session ${sessionId} already exists at ${displayPath}.`,
        );
      }

      await atomicWriteRecord(recordPath, record);
      await upsertIndexEntry(paths.indexPath, config.buildIndexEntry(record));

      registerBufferEntry({
        key: recordPath,
        sessionId,
        recordPath,
        lockPath: paths.lockPath,
        sessionsDir: paths.sessionsDir,
        indexPath: paths.indexPath,
        root: paths.root,
        record,
        lastPersistedStatus: config.getRecordStatus(record),
        dirty: false,
      });
    } catch (error) {
      if (error instanceof SessionRecordMutationError) {
        throw error;
      }

      if (isFileSystemError(error)) {
        throw new SessionRecordMutationError(
          `Failed to initialize session history at ${displayPath}: ${error.message}`,
        );
      }
      throw error;
    } finally {
      await releaseLock();
    }
  }

  async function rewriteRecord(
    options: RewriteSessionRecordOptions<RecordType>,
  ): Promise<RecordType> {
    const { paths, sessionId, mutate } = options;
    const recordPath = join(
      paths.sessionsDir,
      sessionId,
      config.recordFilename,
    );

    const entry = await getOrLoadBufferEntry({
      key: recordPath,
      sessionId,
      recordPath,
      lockPath: paths.lockPath,
      sessionsDir: paths.sessionsDir,
      indexPath: paths.indexPath,
      root: paths.root,
    });

    const mutated = mutate(entry.record);
    if (config.getRecordId(mutated) !== sessionId) {
      throw new SessionRecordMutationError(
        `Refusing to change session identifier while rewriting history for ${sessionId}.`,
      );
    }

    entry.record = mutated;
    entry.dirty = true;

    if (config.shouldForceFlush(entry.record)) {
      await flushBufferEntry(entry, { force: true });
      await disposeBufferEntry(entry);
    } else {
      scheduleBufferFlush(entry);
    }

    return mutated;
  }

  async function getRecordSnapshot(options: {
    paths: SessionPersistencePaths;
    sessionId: string;
  }): Promise<RecordType | undefined> {
    const { paths, sessionId } = options;
    const recordPath = join(
      paths.sessionsDir,
      sessionId,
      config.recordFilename,
    );
    const buffered = buffer.get(recordPath);
    if (buffered) {
      return structuredClone(buffered.record);
    }

    try {
      return await readRecordFromDisk(recordPath);
    } catch (error) {
      if (error instanceof SessionRecordNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  async function flushAllRecordBuffers(): Promise<void> {
    const entries = Array.from(buffer.values());
    for (const entry of entries) {
      await flushBufferEntry(entry, { force: true });
      await disposeBufferEntry(entry);
    }
  }

  async function disposeRecordBuffer(options: {
    paths: SessionPersistencePaths;
    sessionId: string;
  }): Promise<void> {
    const { paths, sessionId } = options;
    const recordPath = join(
      paths.sessionsDir,
      sessionId,
      config.recordFilename,
    );
    const entry = buffer.get(recordPath);
    if (!entry) {
      return;
    }
    await disposeBufferEntry(entry);
  }

  async function flushRecordBuffer(options: {
    paths: SessionPersistencePaths;
    sessionId: string;
  }): Promise<void> {
    const { paths, sessionId } = options;
    const recordPath = join(
      paths.sessionsDir,
      sessionId,
      config.recordFilename,
    );
    const entry = buffer.get(recordPath);
    if (!entry) {
      return;
    }
    await flushBufferEntry(entry, { force: true });
    await disposeBufferEntry(entry);
  }

  function snapshotRecordBuffers(): SessionRecordBufferSnapshotEntry[] {
    return Array.from(buffer.values()).map((entry) => ({
      key: entry.key,
      sessionId: entry.sessionId,
      hasFlushTimer: Boolean(entry.flushTimer),
    }));
  }

  function registerBufferEntry(
    entry: SessionRecordBufferEntry<RecordType, StatusType>,
  ): void {
    buffer.set(entry.key, entry);
  }

  async function getOrLoadBufferEntry(
    template: Omit<
      SessionRecordBufferEntry<RecordType, StatusType>,
      "record" | "lastPersistedStatus" | "dirty"
    >,
  ): Promise<SessionRecordBufferEntry<RecordType, StatusType>> {
    const existing = buffer.get(template.key);
    if (existing) {
      return existing;
    }

    const record = await readRecordFromDisk(template.recordPath);
    const entry: SessionRecordBufferEntry<RecordType, StatusType> = {
      ...template,
      record,
      lastPersistedStatus: config.getRecordStatus(record),
      dirty: false,
    };
    buffer.set(template.key, entry);
    return entry;
  }

  function scheduleBufferFlush(
    entry: SessionRecordBufferEntry<RecordType, StatusType>,
  ): void {
    if (entry.flushTimer) {
      return;
    }
    const timer = setTimeout(() => {
      entry.flushTimer = undefined;
      void flushBufferEntry(entry).catch((error) => {
        console.warn(
          `[voratiq] Failed to flush session ${entry.sessionId} history: ${(error as Error).message}`,
        );
      });
    }, BUFFER_FLUSH_DELAY_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    entry.flushTimer = timer;
  }

  async function flushBufferEntry(
    entry: SessionRecordBufferEntry<RecordType, StatusType>,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const { force = false } = options;
    if (!entry.dirty && !force) {
      return;
    }
    if (entry.flushPromise) {
      await entry.flushPromise;
      return;
    }

    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = undefined;
    }

    await mkdir(entry.sessionsDir, { recursive: true });
    await mkdir(dirname(entry.recordPath), { recursive: true });

    const promise = (async () => {
      const release = await config.acquireLock(entry.lockPath);
      try {
        await atomicWriteRecord(entry.recordPath, entry.record);
        entry.dirty = false;

        const currentStatus = config.getRecordStatus(entry.record);
        if (entry.lastPersistedStatus !== currentStatus) {
          await upsertIndexEntry(
            entry.indexPath,
            config.buildIndexEntry(entry.record),
          );
          entry.lastPersistedStatus = currentStatus;
        }
      } finally {
        await release();
      }
    })();

    entry.flushPromise = promise;
    try {
      await promise;
    } finally {
      entry.flushPromise = undefined;
    }
  }

  async function disposeBufferEntry(
    entry: SessionRecordBufferEntry<RecordType, StatusType>,
  ): Promise<void> {
    const current = buffer.get(entry.key);
    if (!current || current !== entry) {
      return;
    }

    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = undefined;
    }

    if (entry.flushPromise) {
      await entry.flushPromise;
    }

    buffer.delete(entry.key);
  }

  async function readRecordFromDisk(path: string): Promise<RecordType> {
    try {
      const raw = await readFile(path, "utf8");
      return config.parseRecord({ path, raw });
    } catch (error) {
      if (isFileSystemError(error) && error.code === "ENOENT") {
        const sessionId = extractIdFromPath(path);
        throw new SessionRecordNotFoundError(sessionId);
      }

      if (error instanceof SyntaxError) {
        throw new SessionRecordParseError(path, error.message);
      }
      throw error;
    }
  }

  function extractIdFromPath(path: string): string {
    if (config.extractIdFromRecordPath) {
      return config.extractIdFromRecordPath(path);
    }
    const segments = path.split(/[/\\]/);
    const sessionIdIndex = segments.length - 2;
    return segments[sessionIdIndex] ?? "unknown";
  }

  async function atomicWriteRecord(
    path: string,
    payload: RecordType,
  ): Promise<void> {
    const dir = dirname(path);
    const tempPath = join(dir, `${randomBytes(8).toString("hex")}.tmp`);
    const serialized = config.serializeRecord
      ? config.serializeRecord(payload)
      : `${JSON.stringify(payload, null, 2)}\n`;
    await writeFile(tempPath, serialized, { encoding: "utf8" });
    await rename(tempPath, path);
  }

  async function readIndex(
    path: string,
  ): Promise<SessionIndexPayload<IndexEntry>> {
    try {
      const raw = await readFile(path, "utf8");
      const trimmed = raw.trim();
      if (!trimmed) {
        return { version: config.indexVersion, sessions: [] };
      }
      const parsed = JSON.parse(trimmed) as unknown;
      const sessions = config.readIndexEntries
        ? config.readIndexEntries(parsed)
        : Array.isArray((parsed as { sessions?: unknown }).sessions)
          ? ((parsed as { sessions: IndexEntry[] }).sessions ?? [])
          : [];
      return {
        version:
          typeof (parsed as { version?: unknown }).version === "number"
            ? (parsed as { version: number }).version
            : config.indexVersion,
        sessions,
      };
    } catch (error) {
      if (isFileSystemError(error) && error.code === "ENOENT") {
        return { version: config.indexVersion, sessions: [] };
      }
      if (error instanceof SyntaxError) {
        throw new SessionRecordParseError(path, error.message);
      }
      throw error;
    }
  }

  async function upsertIndexEntry(
    indexPath: string,
    entry: IndexEntry,
  ): Promise<void> {
    const payload = await readIndex(indexPath);
    const incomingId = config.getIndexEntryId(entry);
    const existingIndex = payload.sessions.findIndex(
      (session) => config.getIndexEntryId(session) === incomingId,
    );
    if (existingIndex >= 0) {
      const existing = payload.sessions[existingIndex];
      payload.sessions[existingIndex] = config.mergeIndexEntry
        ? config.mergeIndexEntry(existing, entry)
        : { ...existing, ...entry };
    } else {
      payload.sessions.push(entry);
    }
    payload.version = config.indexVersion;
    const serializedPayload = config.buildIndexPayload
      ? config.buildIndexPayload(payload.sessions, payload.version)
      : { version: payload.version, sessions: payload.sessions };
    await atomicWriteIndex(indexPath, serializedPayload);
  }

  async function atomicWriteIndex(
    path: string,
    payload: unknown,
  ): Promise<void> {
    const dir = dirname(path);
    const tempPath = join(dir, `${randomBytes(8).toString("hex")}.tmp`);
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    await writeFile(tempPath, serialized, { encoding: "utf8" });
    await rename(tempPath, path);
  }

  return {
    readRecords,
    appendRecord,
    rewriteRecord,
    getRecordSnapshot,
    flushAllRecordBuffers,
    disposeRecordBuffer,
    flushRecordBuffer,
    snapshotRecordBuffers,
    setReadRecordsImplementation,
    resetReadRecordsImplementation,
  };
}
