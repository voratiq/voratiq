import { spawn } from "node:child_process";
import { access, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  acquireHistoryLock,
  createHistoryLockMetadata,
  detectStaleHistoryLock,
  type HistoryLockMetadata,
} from "../../src/runs/records/history-lock.js";
import { HISTORY_LOCK_STALE_GRACE_MS } from "../../src/runs/records/persistence.js";

describe("history locks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "voratiq-history-lock-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("treats a freshly created lock owned by the current process as active", async () => {
    const lockPath = join(tempDir, "history.lock");
    const metadata = createHistoryLockMetadata();
    await writeLock(lockPath, metadata);

    const result = await detectStaleHistoryLock(
      lockPath,
      HISTORY_LOCK_STALE_GRACE_MS,
    );

    expect(result).toBeDefined();
    expect(result?.isStale).toBe(false);
    expect(result?.ownerPid).toBe(process.pid);
    expect(result?.ownerAlive).toBe(true);
  });

  it("marks a lock without metadata older than the grace period as stale", async () => {
    const lockPath = join(tempDir, "history.lock");
    await writeLock(lockPath, {});
    await ageLock(lockPath, HISTORY_LOCK_STALE_GRACE_MS + 5_000);

    const now = Date.now();
    const result = await detectStaleHistoryLock(
      lockPath,
      HISTORY_LOCK_STALE_GRACE_MS,
      now,
    );

    expect(result).toBeDefined();
    expect(result?.isStale).toBe(true);
    expect(result?.ownerPid).toBeUndefined();
    expect(result?.ageMs).toBeGreaterThanOrEqual(HISTORY_LOCK_STALE_GRACE_MS);
  });

  it("marks a lock owned by a terminated process as stale once beyond the grace period", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    const childPid = child.pid;
    if (!childPid) {
      throw new Error("Failed to capture child pid");
    }

    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });

    const lockPath = join(tempDir, "history.lock");
    await writeLock(lockPath, {
      pid: childPid,
      createdAt: new Date().toISOString(),
    });
    await ageLock(lockPath, HISTORY_LOCK_STALE_GRACE_MS + 2_000);

    const result = await detectStaleHistoryLock(
      lockPath,
      HISTORY_LOCK_STALE_GRACE_MS,
    );

    expect(result).toBeDefined();
    expect(result?.isStale).toBe(true);
    expect(result?.ownerPid).toBe(childPid);
    expect(result?.ownerAlive).toBe(false);
  });

  it("creates and releases exclusive locks via acquireHistoryLock", async () => {
    const lockPath = join(tempDir, "history.lock");
    const release = await acquireHistoryLock(lockPath);

    await expect(access(lockPath)).resolves.toBeUndefined();

    await release();

    await expect(access(lockPath)).rejects.toBeDefined();
  });
});

async function writeLock(
  path: string,
  metadata: HistoryLockMetadata,
): Promise<void> {
  const payload =
    Object.keys(metadata).length === 0 ? "" : `${JSON.stringify(metadata)}\n`;
  await writeFile(path, payload, "utf8");
}

async function ageLock(path: string, ageMs: number): Promise<void> {
  const target = new Date(Date.now() - ageMs);
  await utimes(path, target, target);
}
