import { constants as fsConstants } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { isFileSystemError, safeUnlink } from "../../utils/fs.js";
import { RunHistoryLockTimeoutError } from "./errors.js";

export interface HistoryLockMetadata {
  pid?: number;
  createdAt?: string;
}

export interface HistoryLockInfo {
  path: string;
  metadata?: HistoryLockMetadata;
  mtimeMs: number;
}

export interface HistoryLockStalenessResult {
  info: HistoryLockInfo;
  ageMs: number;
  ownerPid?: number;
  ownerAlive: boolean;
  isStale: boolean;
}

export interface AcquireHistoryLockOptions {
  timeoutMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  staleAfterMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MIN_DELAY_MS = 25;
const DEFAULT_MAX_DELAY_MS = 750;
const DEFAULT_STALE_AFTER_MS = DEFAULT_TIMEOUT_MS * 2;

export const HISTORY_LOCK_STALE_GRACE_MS = DEFAULT_STALE_AFTER_MS;

export async function acquireHistoryLock(
  lockPath: string,
  options: AcquireHistoryLockOptions = {},
): Promise<() => Promise<void>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    minDelayMs = DEFAULT_MIN_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
  } = options;

  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    ensureWithinTimeout(lockPath, startedAt, timeoutMs);

    try {
      const handle = await open(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(
          `${JSON.stringify(createHistoryLockMetadata())}\n`,
          {
            encoding: "utf8",
          },
        );
      } finally {
        await handle.close();
      }

      return registerLockRelease(lockPath);
    } catch (error) {
      if (isFileSystemError(error) && error.code === "EEXIST") {
        const stale = await detectStaleHistoryLock(lockPath, staleAfterMs);
        if (stale?.isStale) {
          await safeUnlink(lockPath);
          continue;
        }

        attempt += 1;
        await delay(computeBackoffDelay(attempt, minDelayMs, maxDelayMs));
        continue;
      }
      throw error;
    }
  }
}

function ensureWithinTimeout(
  lockPath: string,
  startedAt: number,
  timeoutMs: number,
): void {
  if (Date.now() - startedAt >= timeoutMs) {
    throw new RunHistoryLockTimeoutError(lockPath);
  }
}

function computeBackoffDelay(
  attempt: number,
  minDelayMs: number,
  maxDelayMs: number,
): number {
  const base = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
  const jitter = Math.random() * (base - minDelayMs);
  return Math.max(minDelayMs, Math.floor(minDelayMs + jitter));
}

function registerLockRelease(lockPath: string): () => Promise<void> {
  let released = false;
  const listeners: Array<{
    event: string;
    handler: (...args: unknown[]) => void;
  }> = [];

  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    await safeUnlink(lockPath);
  };

  const wrap = (handler: () => void) => (): void => {
    try {
      handler();
    } catch (error) {
      console.warn(
        `[voratiq] Failed to release history lock at ${lockPath}: ${(error as Error).message}`,
      );
    }
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    const handler = wrap(() => {
      void release();
    });
    process.once(signal, handler);
    listeners.push({ event: signal, handler });
  }

  const exitHandler = wrap(() => {
    void release();
  });
  process.once("exit", exitHandler);
  listeners.push({ event: "exit", handler: exitHandler });

  const uncaughtHandler = wrap(() => {
    void release();
  });
  process.once("uncaughtException", uncaughtHandler);
  listeners.push({ event: "uncaughtException", handler: uncaughtHandler });

  const rejectionHandler = wrap(() => {
    void release();
  });
  process.once("unhandledRejection", rejectionHandler);
  listeners.push({ event: "unhandledRejection", handler: rejectionHandler });

  return async (): Promise<void> => {
    for (const listener of listeners) {
      process.removeListener(listener.event, listener.handler as () => void);
    }
    await release();
  };
}

export function createHistoryLockMetadata(): HistoryLockMetadata {
  return {
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
}

export async function detectStaleHistoryLock(
  lockPath: string,
  staleAfterMs: number,
  now: number = Date.now(),
): Promise<HistoryLockStalenessResult | undefined> {
  const info = await readHistoryLockInfo(lockPath);
  if (!info) {
    return undefined;
  }

  const ageMs = Math.max(0, now - info.mtimeMs);
  const ownerPid = info.metadata?.pid;
  const ownerAlive = ownerPid ? isProcessAlive(ownerPid) : false;
  const isStale =
    ageMs >= staleAfterMs &&
    (!ownerAlive || ownerPid === process.pid || ownerPid === undefined);

  return {
    info,
    ageMs,
    ownerPid,
    ownerAlive,
    isStale,
  };
}

export async function readHistoryLockInfo(
  lockPath: string,
): Promise<HistoryLockInfo | undefined> {
  try {
    const stats = await stat(lockPath);
    const metadata = await readHistoryLockMetadata(lockPath);
    return {
      path: lockPath,
      metadata,
      mtimeMs: stats.mtimeMs,
    };
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readHistoryLockMetadata(
  lockPath: string,
): Promise<HistoryLockMetadata | undefined> {
  try {
    const raw = await readFile(lockPath, { encoding: "utf8" });
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = JSON.parse(trimmed) as HistoryLockMetadata;
    return parsed;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

function isProcessAlive(pid?: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      const code = (error as { code?: string }).code;
      if (code === "ESRCH") {
        return false;
      }
      if (code === "EPERM") {
        return true;
      }
    }
    return false;
  }
}
