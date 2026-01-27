import { dirname, join } from "node:path";

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
import { assertTestHookRegistrationEnabled } from "../../testing/test-hooks.js";
import { toErrorMessage } from "../../utils/errors.js";
import { isFileSystemError } from "../../utils/fs.js";
import {
  RunOptionValidationError,
  RunRecordMutationError,
  RunRecordNotFoundError,
  RunRecordParseError,
} from "./errors.js";
import { acquireHistoryLock } from "./history-lock.js";
import {
  type RunApplyStatus,
  type RunRecord,
  runRecordSchema,
} from "./types.js";

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

export type RunRecordBufferSnapshotEntry = {
  key: string;
  runId: string;
  hasFlushTimer: boolean;
};

const RUN_INDEX_VERSION = 2;
export const RUN_RECORD_FILENAME = "record.json";
const HISTORY_LOCK_FILENAME = "history.lock";

const runPersistence = createSessionPersistence<
  RunRecord,
  RunIndexEntry,
  RunRecord["status"]
>({
  recordFilename: RUN_RECORD_FILENAME,
  indexVersion: RUN_INDEX_VERSION,
  acquireLock: acquireHistoryLock,
  parseRecord: ({ path, raw }) => {
    const parsed = JSON.parse(raw) as unknown;
    const result = runRecordSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => issue.message)
        .join(", ");
      throw new SessionRecordParseError(path, issues);
    }
    return result.data;
  },
  mergeRecordOnFlush: (buffered, disk) => mergeApplyStatus(buffered, disk),
  buildIndexEntry: (record) => ({
    runId: record.runId,
    createdAt: record.createdAt,
    status: record.status,
  }),
  getIndexEntryId: (entry) => entry.runId,
  shouldForceFlush: (record) => shouldForceFlush(record.status),
  getRecordId: (record) => record.runId,
  getRecordStatus: (record) => record.status,
  readIndexEntries: (parsed) => {
    const payload = parsed as { sessions?: RunIndexEntry[] };
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  },
});

const readRunRecordsInternal: ReadRunRecordsFn = async (
  options: ReadRunRecordsOptions,
): Promise<RunRecord[]> => {
  const { root, runsFilePath, limit, predicate, onWarning } = options;
  const paths = buildRunPaths(root, runsFilePath);

  try {
    return await runPersistence.readRecords({
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
  const paths = buildRunPaths(root, runsFilePath);

  try {
    await runPersistence.appendRecord({ paths, record });
  } catch (error) {
    mapSessionError(error);
  }
}

export async function rewriteRunRecord(
  options: RewriteRunRecordOptions,
): Promise<RunRecord> {
  const { root, runsFilePath, runId, mutate } = options;
  const paths = buildRunPaths(root, runsFilePath);

  try {
    return await runPersistence.rewriteRecord({
      paths,
      sessionId: runId,
      mutate,
    });
  } catch (error) {
    mapSessionError(error);
  }
}

export async function getRunRecordSnapshot(options: {
  runsFilePath: string;
  runId: string;
}): Promise<RunRecord | undefined> {
  const { runsFilePath, runId } = options;
  const paths = buildRunPaths("", runsFilePath);

  try {
    return await runPersistence.getRecordSnapshot({
      paths,
      sessionId: runId,
    });
  } catch (error) {
    mapSessionError(error);
  }
}

export async function flushAllRunRecordBuffers(): Promise<void> {
  await runPersistence.flushAllRecordBuffers();
}

export async function disposeRunRecordBuffer(options: {
  runsFilePath: string;
  runId: string;
}): Promise<void> {
  const { runsFilePath, runId } = options;
  const paths = buildRunPaths("", runsFilePath);

  await runPersistence.disposeRecordBuffer({ paths, sessionId: runId });
}

export async function flushRunRecordBuffer(options: {
  runsFilePath: string;
  runId: string;
}): Promise<void> {
  const { runsFilePath, runId } = options;
  const paths = buildRunPaths("", runsFilePath);

  await runPersistence.flushRecordBuffer({ paths, sessionId: runId });
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

function shouldForceFlush(status: RunRecord["status"]): boolean {
  return status !== "running" && status !== "queued";
}

function mergeApplyStatus(buffered: RunRecord, disk?: RunRecord): RunRecord {
  const latest = pickLatestApplyStatus(buffered.applyStatus, disk?.applyStatus);
  if (!latest) {
    return buffered;
  }

  const bufferedStatus = buffered.applyStatus;
  if (bufferedStatus && areSameApplyStatus(bufferedStatus, latest)) {
    return buffered;
  }

  return {
    ...buffered,
    applyStatus: { ...latest },
  };
}

function pickLatestApplyStatus(
  buffered?: RunApplyStatus,
  disk?: RunApplyStatus,
): RunApplyStatus | undefined {
  if (!buffered) {
    return disk;
  }
  if (!disk) {
    return buffered;
  }

  return compareApplyStatus(buffered, disk) >= 0 ? buffered : disk;
}

function compareApplyStatus(a: RunApplyStatus, b: RunApplyStatus): number {
  const aTime = Date.parse(a.appliedAt);
  const bTime = Date.parse(b.appliedAt);

  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  if (aValid && bValid) {
    return aTime - bTime;
  }
  if (aValid) {
    return 1;
  }
  if (bValid) {
    return -1;
  }

  return a.appliedAt.localeCompare(b.appliedAt);
}

function areSameApplyStatus(a: RunApplyStatus, b: RunApplyStatus): boolean {
  return (
    a.agentId === b.agentId &&
    a.status === b.status &&
    a.appliedAt === b.appliedAt &&
    a.ignoredBaseMismatch === b.ignoredBaseMismatch &&
    a.appliedCommitSha === b.appliedCommitSha &&
    (a.detail ?? undefined) === (b.detail ?? undefined)
  );
}

function buildRunPaths(
  root: string,
  runsFilePath: string,
): SessionPersistencePaths {
  const runsRoot = getRunsDirectory(runsFilePath);
  return {
    root,
    indexPath: runsFilePath,
    sessionsDir: getSessionsDirectory(runsFilePath),
    lockPath: join(runsRoot, HISTORY_LOCK_FILENAME),
  };
}

function getRunsDirectory(runsFilePath: string): string {
  return dirname(runsFilePath);
}

function getSessionsDirectory(runsFilePath: string): string {
  return join(getRunsDirectory(runsFilePath), "sessions");
}

function mapWarning(warning: SessionRecordWarning): RunRecordWarning {
  if (warning.kind === "parse-error") {
    const parseWarning = warning;
    return {
      kind: "parse-error",
      runId: parseWarning.sessionId,
      recordPath: parseWarning.recordPath,
      displayPath: parseWarning.displayPath,
      details: parseWarning.details,
    };
  }

  const missingWarning = warning;
  return {
    kind: "missing-record",
    runId: missingWarning.sessionId,
    recordPath: missingWarning.recordPath,
    displayPath: missingWarning.displayPath,
  };
}

function mapSessionError(error: unknown): never {
  if (error instanceof SessionOptionValidationError) {
    throw new RunOptionValidationError(error.option, error.detail);
  }
  if (error instanceof SessionRecordParseError) {
    throw new RunRecordParseError(error.displayPath, error.details);
  }
  if (error instanceof SessionRecordNotFoundError) {
    throw new RunRecordNotFoundError(error.sessionId);
  }
  if (error instanceof SessionRecordMutationError) {
    throw new RunRecordMutationError(error.detail);
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(toErrorMessage(error));
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
  return runPersistence.snapshotRecordBuffers().map((entry) => ({
    key: entry.key,
    runId: entry.sessionId,
    hasFlushTimer: entry.hasFlushTimer,
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
