import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertTestHookRegistrationEnabled } from "../testing/test-hooks.js";
import { isFileSystemError, pathExists } from "../utils/fs.js";
import { relativeToRoot } from "../utils/path.js";
import {
  RunOptionValidationError,
  RunRecordMutationError,
  RunRecordNotFoundError,
  RunRecordParseError,
} from "./errors.js";
import { acquireHistoryLock } from "./history-lock.js";
import { type RunRecord, runRecordSchema } from "./types.js";

export { HISTORY_LOCK_STALE_GRACE_MS } from "./history-lock.js";

export type RunRecordPredicate = (record: RunRecord) => boolean;

export interface RunRecordWarningMissing {
  kind: "missing-record";
  runId: string;
  recordPath: string;
  displayPath: string;
}

export interface RunRecordWarningParse {
  kind: "parse-error";
  runId: string;
  recordPath: string;
  displayPath: string;
  details: string;
}

export type RunRecordWarning = RunRecordWarningMissing | RunRecordWarningParse;

export interface ReadRunRecordsOptions {
  root: string;
  runsFilePath: string;
  limit?: number;
  predicate?: RunRecordPredicate;
  onWarning?: (warning: RunRecordWarning) => void;
}

export interface RewriteRunRecordOptions {
  root: string;
  runsFilePath: string;
  runId: string;
  mutate: (record: RunRecord) => RunRecord;
}

export interface RunQueryFilters {
  runId?: string;
  agentId?: string;
  specPath?: string;
  includeDeleted?: boolean;
  activeOnly?: boolean;
}

export interface RunQueryInput {
  root: string;
  runsFilePath: string;
  filters?: RunQueryFilters;
  limit?: number;
}

export interface RunQueryResult {
  records: RunRecord[];
  warnings: RunRecordWarning[];
}

export interface AppendRunRecordOptions {
  root: string;
  runsFilePath: string;
  record: RunRecord;
}

type ReadRunRecordsFn = (
  options: ReadRunRecordsOptions,
) => Promise<RunRecord[]>;

export type RunIndexEntry = Pick<RunRecord, "runId" | "createdAt" | "status">;

export interface RunIndexPayload {
  version: number;
  sessions: RunIndexEntry[];
}

interface RunRecordBufferEntry {
  key: string;
  runId: string;
  recordPath: string;
  lockPath: string;
  runsDir: string;
  runsFilePath: string;
  root: string;
  record: RunRecord;
  lastPersistedStatus: RunRecord["status"];
  dirty: boolean;
  flushTimer?: NodeJS.Timeout;
  flushPromise?: Promise<void>;
}

const RUN_INDEX_VERSION = 2;
export const RUN_RECORD_FILENAME = "record.json";
const HISTORY_LOCK_FILENAME = "history.lock";
const BUFFER_FLUSH_DELAY_MS = 250;

const runRecordBuffers = new Map<string, RunRecordBufferEntry>();

export type RunRecordBufferSnapshotEntry = {
  key: string;
  runId: string;
  hasFlushTimer: boolean;
};

const readRunRecordsInternal: ReadRunRecordsFn = async (
  options: ReadRunRecordsOptions,
): Promise<RunRecord[]> => {
  const { root, runsFilePath, limit, predicate, onWarning } = options;

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new RunOptionValidationError("limit", "must be a positive integer");
  }

  const sessionsDir = getSessionsDirectory(runsFilePath);
  let index: RunIndexPayload;
  try {
    index = await readRunIndex(runsFilePath);
  } catch (error) {
    if (error instanceof RunRecordParseError) {
      const displayPath = relativeToRoot(root, runsFilePath);
      throw new RunRecordParseError(displayPath, error.details);
    }
    throw error;
  }
  const matches: RunRecord[] = [];

  for (let i = index.sessions.length - 1; i >= 0; i -= 1) {
    const entry = index.sessions[i];
    if (!entry) {
      continue;
    }

    const recordPath = join(sessionsDir, entry.runId, RUN_RECORD_FILENAME);
    try {
      const record = await readRunRecordFromDisk(recordPath);
      if (predicate && !predicate(record)) {
        continue;
      }
      matches.push(record);
      if (limit !== undefined && matches.length >= limit) {
        break;
      }
    } catch (error) {
      if (error instanceof RunRecordParseError) {
        const warning: RunRecordWarningParse = {
          kind: "parse-error",
          runId: entry.runId,
          recordPath,
          displayPath: relativeToRoot(root, recordPath),
          details: error.details,
        };
        onWarning?.(warning);
        continue;
      }
      if (error instanceof RunRecordNotFoundError) {
        const warning: RunRecordWarningMissing = {
          kind: "missing-record",
          runId: entry.runId,
          recordPath,
          displayPath: relativeToRoot(root, recordPath),
        };
        onWarning?.(warning);
        continue;
      }
      throw error;
    }
  }

  return matches;
};

let readRunRecordsImpl: ReadRunRecordsFn = readRunRecordsInternal;

function setReadRunRecordsImplementation(
  implementation: ReadRunRecordsFn,
): void {
  readRunRecordsImpl = implementation;
}

function resetReadRunRecordsImplementation(): void {
  readRunRecordsImpl = readRunRecordsInternal;
}

export async function readRunRecords(
  options: ReadRunRecordsOptions,
): Promise<RunRecord[]> {
  return readRunRecordsImpl(options);
}

export async function appendRunRecord(
  options: AppendRunRecordOptions,
): Promise<void> {
  const { root, runsFilePath, record } = options;
  const runsRoot = getRunsDirectory(runsFilePath);
  const sessionsDir = getSessionsDirectory(runsFilePath);
  const recordDir = join(sessionsDir, record.runId);
  const recordPath = join(recordDir, RUN_RECORD_FILENAME);
  const displayPath = relativeToRoot(root, recordPath);
  const lockPath = join(runsRoot, HISTORY_LOCK_FILENAME);

  await mkdir(recordDir, { recursive: true });
  const releaseLock = await acquireHistoryLock(lockPath);

  try {
    if (await pathExists(recordPath)) {
      throw new RunRecordMutationError(
        `Run ${record.runId} already exists at ${displayPath}.`,
      );
    }

    await atomicWriteJson(recordPath, record);
    await upsertRunIndexEntry(runsFilePath, {
      runId: record.runId,
      createdAt: record.createdAt,
      status: record.status,
    });

    registerBufferEntry({
      key: recordPath,
      runId: record.runId,
      recordPath,
      lockPath,
      runsDir: runsRoot,
      runsFilePath,
      root,
      record,
      lastPersistedStatus: record.status,
      dirty: false,
    });
  } catch (error) {
    if (error instanceof RunRecordMutationError) {
      throw error;
    }

    if (isFileSystemError(error)) {
      throw new RunRecordMutationError(
        `Failed to initialize run history at ${displayPath}: ${error.message}`,
      );
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

export async function rewriteRunRecord(
  options: RewriteRunRecordOptions,
): Promise<RunRecord> {
  const { root, runsFilePath, runId, mutate } = options;
  const runsRoot = getRunsDirectory(runsFilePath);
  const sessionsDir = getSessionsDirectory(runsFilePath);
  const recordPath = join(sessionsDir, runId, RUN_RECORD_FILENAME);
  const lockPath = join(runsRoot, HISTORY_LOCK_FILENAME);

  const entry = await getOrLoadBufferEntry({
    key: recordPath,
    runId,
    recordPath,
    lockPath,
    runsDir: runsRoot,
    runsFilePath,
    root,
  });

  const mutated = mutate(entry.record);
  if (mutated.runId !== runId) {
    throw new RunRecordMutationError(
      `Refusing to change run identifier while rewriting history for ${runId}.`,
    );
  }

  entry.record = mutated;
  entry.dirty = true;

  const shouldFlushImmediately = shouldForceFlush(entry.record.status);
  if (shouldFlushImmediately) {
    await flushBufferEntry(entry, { force: true });
    await disposeBufferEntry(entry);
  } else {
    scheduleBufferFlush(entry);
  }

  return mutated;
}

export async function getRunRecordSnapshot(options: {
  runsFilePath: string;
  runId: string;
}): Promise<RunRecord | undefined> {
  const { runsFilePath, runId } = options;
  const sessionsDir = getSessionsDirectory(runsFilePath);
  const recordPath = join(sessionsDir, runId, RUN_RECORD_FILENAME);

  const buffered = runRecordBuffers.get(recordPath);
  if (buffered) {
    return structuredClone(buffered.record);
  }

  try {
    return await readRunRecordFromDisk(recordPath);
  } catch (error) {
    if (error instanceof RunRecordNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

function shouldForceFlush(status: RunRecord["status"]): boolean {
  return status !== "running" && status !== "queued";
}

export async function flushAllRunRecordBuffers(): Promise<void> {
  const entries = Array.from(runRecordBuffers.values());
  for (const entry of entries) {
    await flushBufferEntry(entry, { force: true });
    await disposeBufferEntry(entry);
  }
}

export async function disposeRunRecordBuffer(options: {
  runsFilePath: string;
  runId: string;
}): Promise<void> {
  const { runsFilePath, runId } = options;
  const recordPath = join(
    getSessionsDirectory(runsFilePath),
    runId,
    RUN_RECORD_FILENAME,
  );
  const entry = runRecordBuffers.get(recordPath);
  if (!entry) {
    return;
  }
  await disposeBufferEntry(entry);
}

export async function flushRunRecordBuffer(options: {
  runsFilePath: string;
  runId: string;
}): Promise<void> {
  const { runsFilePath, runId } = options;
  const recordPath = join(
    getSessionsDirectory(runsFilePath),
    runId,
    RUN_RECORD_FILENAME,
  );
  const entry = runRecordBuffers.get(recordPath);
  if (!entry) {
    return;
  }
  await flushBufferEntry(entry, { force: true });
  await disposeBufferEntry(entry);
}

function registerBufferEntry(entry: RunRecordBufferEntry): void {
  runRecordBuffers.set(entry.key, entry);
}

async function getOrLoadBufferEntry(
  template: Omit<
    RunRecordBufferEntry,
    "record" | "lastPersistedStatus" | "dirty"
  >,
): Promise<RunRecordBufferEntry> {
  const existing = runRecordBuffers.get(template.key);
  if (existing) {
    return existing;
  }

  const record = await readRunRecordFromDisk(template.recordPath);
  const entry: RunRecordBufferEntry = {
    ...template,
    record,
    lastPersistedStatus: record.status,
    dirty: false,
  };
  runRecordBuffers.set(template.key, entry);
  return entry;
}

function scheduleBufferFlush(entry: RunRecordBufferEntry): void {
  if (entry.flushTimer) {
    return;
  }
  const timer = setTimeout(() => {
    entry.flushTimer = undefined;
    void flushBufferEntry(entry).catch((error) => {
      console.warn(
        `[voratiq] Failed to flush run ${entry.runId} history: ${(error as Error).message}`,
      );
    });
  }, BUFFER_FLUSH_DELAY_MS);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  entry.flushTimer = timer;
}

async function flushBufferEntry(
  entry: RunRecordBufferEntry,
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

  await mkdir(entry.runsDir, { recursive: true });
  await mkdir(dirname(entry.recordPath), { recursive: true });

  const promise = (async () => {
    const release = await acquireHistoryLock(entry.lockPath);
    try {
      await atomicWriteJson(entry.recordPath, entry.record);
      entry.dirty = false;

      if (entry.lastPersistedStatus !== entry.record.status) {
        await upsertRunIndexEntry(entry.runsFilePath, {
          runId: entry.runId,
          createdAt: entry.record.createdAt,
          status: entry.record.status,
        });
        entry.lastPersistedStatus = entry.record.status;
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

async function disposeBufferEntry(entry: RunRecordBufferEntry): Promise<void> {
  const current = runRecordBuffers.get(entry.key);
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

  runRecordBuffers.delete(entry.key);
}

export function buildRunPredicate(
  filters: RunQueryFilters = {},
): RunRecordPredicate {
  const predicates: RunRecordPredicate[] = [];

  if (filters.runId) {
    const runId = filters.runId;
    predicates.push((record) => record.runId === runId);
  }

  if (filters.agentId) {
    const agentId = filters.agentId;
    predicates.push((record) =>
      record.agents.some((agent) => agent.agentId === agentId),
    );
  }

  if (filters.specPath) {
    const specPath = filters.specPath;
    predicates.push((record) => record.spec.path === specPath);
  }

  if (filters.activeOnly || !filters.includeDeleted) {
    predicates.push((record) => record.status !== "pruned");
  }

  return (record: RunRecord) =>
    predicates.every((predicate) => predicate(record));
}

export async function fetchRuns(input: RunQueryInput): Promise<RunQueryResult> {
  const warnings: RunRecordWarning[] = [];
  const predicate = buildRunPredicate(input.filters ?? {});

  const records = await readRunRecords({
    root: input.root,
    runsFilePath: input.runsFilePath,
    limit: input.limit,
    predicate,
    onWarning: (warning) => warnings.push(warning),
  });

  return { records, warnings };
}

export async function fetchRunsSafely(
  input: RunQueryInput & { runId?: string },
): Promise<RunQueryResult> {
  const { runId, filters, ...rest } = input;
  const augmentedFilters = { ...(filters ?? {}), ...(runId ? { runId } : {}) };

  const result = await fetchRuns({
    ...rest,
    filters: augmentedFilters,
  }).catch((error) => {
    if (runId && isFileSystemError(error) && error.code === "ENOENT") {
      throw new RunRecordNotFoundError(runId);
    }
    throw error;
  });

  if (runId) {
    const warning = result.warnings.find((entry) => entry.runId === runId);
    if (warning) {
      if (warning.kind === "parse-error") {
        throw new RunRecordParseError(warning.displayPath, warning.details);
      }
      throw new RunRecordNotFoundError(runId);
    }

    if (result.records.length === 0) {
      throw new RunRecordNotFoundError(runId);
    }
  }

  return result;
}

async function readRunRecordFromDisk(path: string): Promise<RunRecord> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const result = runRecordSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => issue.message)
        .join(", ");
      throw new RunRecordParseError(path, issues);
    }
    return result.data;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      const runId = extractRunIdFromPath(path);
      throw new RunRecordNotFoundError(runId);
    }

    if (error instanceof SyntaxError) {
      throw new RunRecordParseError(path, error.message);
    }
    throw error;
  }
}

function extractRunIdFromPath(path: string): string {
  const segments = path.split(/[/\\]/);
  const runIdIndex = segments.length - 2;
  return segments[runIdIndex] ?? "unknown";
}

async function atomicWriteJson(path: string, payload: unknown): Promise<void> {
  const dir = dirname(path);
  const tempPath = join(dir, `${randomBytes(8).toString("hex")}.tmp`);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(tempPath, serialized, { encoding: "utf8" });
  await rename(tempPath, path);
}

function getRunsDirectory(runsFilePath: string): string {
  return dirname(runsFilePath);
}

function getSessionsDirectory(runsFilePath: string): string {
  return join(getRunsDirectory(runsFilePath), "sessions");
}

async function readRunIndex(path: string): Promise<RunIndexPayload> {
  try {
    const raw = await readFile(path, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      return { version: RUN_INDEX_VERSION, sessions: [] };
    }
    const parsed = JSON.parse(trimmed) as RunIndexPayload & {
      runs?: RunIndexEntry[];
    };
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions
      : Array.isArray(parsed.runs)
        ? parsed.runs
        : [];
    return {
      version: parsed.version ?? RUN_INDEX_VERSION,
      sessions,
    };
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return { version: RUN_INDEX_VERSION, sessions: [] };
    }
    if (error instanceof SyntaxError) {
      throw new RunRecordParseError(path, error.message);
    }
    throw error;
  }
}

async function upsertRunIndexEntry(
  indexPath: string,
  entry: RunIndexEntry,
): Promise<void> {
  const payload = await readRunIndex(indexPath);
  const existingIndex = payload.sessions.findIndex(
    (run) => run.runId === entry.runId,
  );
  if (existingIndex >= 0) {
    payload.sessions[existingIndex] = {
      ...payload.sessions[existingIndex],
      ...entry,
    };
  } else {
    payload.sessions.push(entry);
  }
  payload.version = RUN_INDEX_VERSION;
  await atomicWriteJson(indexPath, payload);
}

const RUN_RECORDS_TEST_HOOKS = Symbol.for(
  "voratiq.records.persistence.testHooks",
);

export type RunRecordsTestHooks = {
  setImplementation: (implementation: ReadRunRecordsFn) => void;
  resetImplementation: () => void;
  getBufferSnapshot: () => RunRecordBufferSnapshotEntry[];
};

export type RunRecordsTestHookRegistry = Partial<
  Record<typeof RUN_RECORDS_TEST_HOOKS, RunRecordsTestHooks>
>;

function registerRunRecordsTestHooks(): void {
  const registry = globalThis as RunRecordsTestHookRegistry;
  registry[RUN_RECORDS_TEST_HOOKS] = {
    setImplementation: setReadRunRecordsImplementation,
    resetImplementation: resetReadRunRecordsImplementation,
    getBufferSnapshot: snapshotRunRecordBuffers,
  };
}

function snapshotRunRecordBuffers(): RunRecordBufferSnapshotEntry[] {
  return Array.from(runRecordBuffers.values()).map((entry) => ({
    key: entry.key,
    runId: entry.runId,
    hasFlushTimer: Boolean(entry.flushTimer),
  }));
}

let runRecordsTestHooksRegistered = false;

export function enableRunRecordsTestHooks(): void {
  assertTestHookRegistrationEnabled("records persistence");
  if (runRecordsTestHooksRegistered) {
    return;
  }
  registerRunRecordsTestHooks();
  runRecordsTestHooksRegistered = true;
}

export function areRunRecordsTestHooksRegistered(): boolean {
  return runRecordsTestHooksRegistered;
}

export { RUN_RECORDS_TEST_HOOKS };
