import { SessionHistoryLockTimeoutError } from "../../sessions/errors.js";
import {
  acquireHistoryLock as acquireSessionHistoryLock,
  type AcquireHistoryLockOptions,
  createHistoryLockMetadata,
  detectStaleHistoryLock,
  HISTORY_LOCK_STALE_GRACE_MS,
  type HistoryLockInfo,
  type HistoryLockMetadata,
  type HistoryLockStalenessResult,
  readHistoryLockInfo,
} from "../../sessions/history-lock.js";
import { RunHistoryLockTimeoutError } from "./errors.js";

export type {
  AcquireHistoryLockOptions,
  HistoryLockInfo,
  HistoryLockMetadata,
  HistoryLockStalenessResult,
};
export {
  createHistoryLockMetadata,
  detectStaleHistoryLock,
  HISTORY_LOCK_STALE_GRACE_MS,
  readHistoryLockInfo,
};

// Retained only for callers that still use the historical run-owned path.
// Shared session lock ownership lives under src/sessions/history-lock.ts.
export async function acquireHistoryLock(
  lockPath: string,
  options: AcquireHistoryLockOptions = {},
): Promise<() => Promise<void>> {
  try {
    return await acquireSessionHistoryLock(lockPath, options);
  } catch (error) {
    if (error instanceof SessionHistoryLockTimeoutError) {
      throw new RunHistoryLockTimeoutError(error.lockPath);
    }
    throw error;
  }
}
