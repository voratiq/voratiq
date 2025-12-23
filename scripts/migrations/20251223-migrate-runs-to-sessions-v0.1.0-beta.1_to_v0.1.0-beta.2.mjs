#!/usr/bin/env node

/**
 * Release-scoped migration: v0.1.0-beta.1 -> v0.1.0-beta.2
 *
 * Moves legacy run storage from .voratiq/runs/<runId>/ to
 * .voratiq/runs/sessions/<runId>/ and rewrites index.json to the
 * version 2 sessions schema. Safe to re-run and defaults to taking
 * a backup of the supplied .voratiq directory.
 */

import { constants as fsConstants, existsSync } from "node:fs";
import {
  cp,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const RUN_INDEX_VERSION = 2;
const LOCK_FILENAME = "history.lock";
const INDEX_FILENAME = "index.json";
const RUN_RECORD_FILENAME = "record.json";

const DEFAULT_BACKUP = true;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_MIN_DELAY_MS = 25;
const DEFAULT_LOCK_MAX_DELAY_MS = 750;
const DEFAULT_LOCK_STALE_AFTER_MS = DEFAULT_LOCK_TIMEOUT_MS * 2;

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: node scripts/migrations/20251223-migrate-runs-to-sessions-v0.1.0-beta.1_to_v0.1.0-beta.2.mjs --voratiq-dir <path> [--backup|--no-backup]",
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let voratiqDir;
  let backup = DEFAULT_BACKUP;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--voratiq-dir") {
      voratiqDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--voratiq-dir=")) {
      [, voratiqDir] = arg.split("=", 2);
      continue;
    }
    if (arg === "--backup") {
      backup = true;
      continue;
    }
    if (arg === "--no-backup") {
      backup = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
    }
    usage(`Unknown argument: ${arg}`);
  }

  if (!voratiqDir) {
    usage("Missing required --voratiq-dir");
  }

  const resolved = path.resolve(voratiqDir);
  return { voratiqDir: resolved, backup };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function createBackup(sourceDir) {
  const parent = path.dirname(sourceDir);
  const baseName = path.basename(sourceDir);
  const backupNameBase = `${baseName}-backup-${nowTimestamp()}`;
  let candidate = path.join(parent, backupNameBase);
  let counter = 0;

  while (existsSync(candidate)) {
    counter += 1;
    candidate = path.join(parent, `${backupNameBase}-${counter}`);
  }

  await cp(sourceDir, candidate, { recursive: true });
  return candidate;
}

function jitteredDelay(attempt, minDelayMs, maxDelayMs) {
  const base = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
  const jitter = Math.random() * (base - minDelayMs);
  return Math.max(minDelayMs, Math.floor(minDelayMs + jitter));
}

async function safeUnlink(targetPath) {
  try {
    await rm(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function isProcessAlive(pid) {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = error.code;
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

async function detectStaleLock(lockPath, staleAfterMs) {
  try {
    const stats = await stat(lockPath);
    let metadata;
    try {
      const raw = await readFile(lockPath, "utf8");
      metadata = raw.trim() ? JSON.parse(raw.trim()) : undefined;
    } catch {
      metadata = undefined;
    }

    const ageMs = Math.max(0, Date.now() - stats.mtimeMs);
    const ownerPid = metadata?.pid;
    const ownerAlive = isProcessAlive(ownerPid);
    const stale =
      ageMs >= staleAfterMs &&
      (!ownerAlive || ownerPid === process.pid || ownerPid === undefined);

    return stale;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function acquireHistoryLock(lockPath, options = {}) {
  const {
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    minDelayMs = DEFAULT_LOCK_MIN_DELAY_MS,
    maxDelayMs = DEFAULT_LOCK_MAX_DELAY_MS,
    staleAfterMs = DEFAULT_LOCK_STALE_AFTER_MS,
  } = options;

  const started = Date.now();
  let attempt = 0;

  while (true) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out acquiring history lock at ${lockPath}`);
    }

    try {
      const handle = await open(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
          })}\n`,
          "utf8",
        );
      } finally {
        await handle.close();
      }
      return async () => safeUnlink(lockPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        const stale = await detectStaleLock(lockPath, staleAfterMs);
        if (stale) {
          await safeUnlink(lockPath);
          continue;
        }
        attempt += 1;
        await delay(jitteredDelay(attempt, minDelayMs, maxDelayMs));
        continue;
      }
      throw error;
    }
  }
}

async function readIndex(indexPath) {
  try {
    const raw = await readFile(indexPath, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      return { version: RUN_INDEX_VERSION, sessions: [] };
    }
    const parsed = JSON.parse(trimmed);
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
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { version: RUN_INDEX_VERSION, sessions: [] };
    }
    throw error;
  }
}

async function writeIndex(indexPath, payload) {
  const dir = path.dirname(indexPath);
  await mkdir(dir, { recursive: true });

  const tempPath = `${indexPath}.${process.pid}.tmp`;
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await writeFile(tempPath, body, "utf8");
    await rename(tempPath, indexPath);
  } catch (error) {
    await safeUnlink(tempPath);
    throw error;
  }
}

async function readRunRecord(recordPath) {
  try {
    const raw = await readFile(recordPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      console.warn(`[migrate] Could not parse ${recordPath}: ${error.message}`);
      return undefined;
    }
    throw error;
  }
}

async function getDirectoryBirthtimeIso(dirPath) {
  try {
    const stats = await stat(dirPath);
    return stats.birthtime?.toISOString?.() ?? stats.mtime?.toISOString?.();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function migrateLegacyRuns(runsDir, sessionsDir) {
  const migrated = [];
  const skipped = [];
  await mkdir(sessionsDir, { recursive: true });

  let entries = [];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { migrated, skipped };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "sessions") {
      continue;
    }

    const runId = entry.name;
    const sourceDir = path.join(runsDir, runId);
    const targetDir = path.join(sessionsDir, runId);

    if (await pathExists(targetDir)) {
      skipped.push(runId);
      continue;
    }

    try {
      await rename(sourceDir, targetDir);
      migrated.push(runId);
      continue;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EXDEV") {
        await cp(sourceDir, targetDir, { recursive: true });
        await rm(sourceDir, { recursive: true, force: true });
        migrated.push(runId);
        continue;
      }
      throw error;
    }
  }

  return { migrated, skipped };
}

async function pruneEmptyLegacyDirs(runsDir, sessionsDir) {
  let entries = [];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === path.basename(sessionsDir)) {
      continue;
    }
    const dirPath = path.join(runsDir, entry.name);
    const contents = await readdir(dirPath);
    if (contents.length === 0) {
      await rm(dirPath, { recursive: true, force: true });
    }
  }
}

async function buildIndexPayload(sessionsDir, existingIndex) {
  const order = [];
  const byRunId = new Map();

  const upsert = (entry) => {
    if (!entry?.runId) {
      return;
    }
    if (!byRunId.has(entry.runId)) {
      order.push(entry.runId);
      byRunId.set(entry.runId, {});
    }
    const current = byRunId.get(entry.runId);
    byRunId.set(entry.runId, {
      ...current,
      ...entry,
    });
  };

  for (const entry of existingIndex.sessions ?? []) {
    upsert(entry);
  }

  let sessionDirs = [];
  try {
    sessionDirs = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      sessionDirs = [];
    } else {
      throw error;
    }
  }

  for (const entry of sessionDirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runId = entry.name;
    const runDir = path.join(sessionsDir, runId);
    const recordPath = path.join(runDir, RUN_RECORD_FILENAME);
    const record = await readRunRecord(recordPath);
    const existing = byRunId.get(runId) ?? {};

    const createdAt =
      record?.createdAt ??
      existing?.createdAt ??
      (await getDirectoryBirthtimeIso(runDir)) ??
      new Date().toISOString();

    const status = record?.status ?? existing?.status ?? "queued";

    upsert({ runId, createdAt, status });
  }

  const sessions = order
    .map((runId) => byRunId.get(runId))
    .filter(Boolean)
    .map((entry) => ({
      runId: entry.runId,
      createdAt: entry.createdAt,
      status: entry.status,
    }));

  return {
    version: RUN_INDEX_VERSION,
    sessions,
  };
}

async function main() {
  const { voratiqDir, backup } = parseArgs();

  const stats = await stat(voratiqDir).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      usage(`Path does not exist: ${voratiqDir}`);
    }
    throw error;
  });
  if (!stats.isDirectory()) {
    usage(`Not a directory: ${voratiqDir}`);
  }

  const runsDir = path.join(voratiqDir, "runs");
  const sessionsDir = path.join(runsDir, "sessions");
  const indexPath = path.join(runsDir, INDEX_FILENAME);
  const lockPath = path.join(runsDir, LOCK_FILENAME);

  if (backup) {
    const backupPath = await createBackup(voratiqDir);
    console.log(`[migrate] Backup created at ${backupPath}`);
  } else {
    console.log("[migrate] Backup disabled via --no-backup");
  }

  await mkdir(runsDir, { recursive: true });
  const releaseLock = await acquireHistoryLock(lockPath);

  try {
    const existingIndex = await readIndex(indexPath);
    const { migrated, skipped } = await migrateLegacyRuns(runsDir, sessionsDir);
    const payload = await buildIndexPayload(sessionsDir, existingIndex);
    await writeIndex(indexPath, payload);
    await pruneEmptyLegacyDirs(runsDir, sessionsDir);

    console.log(
      `[migrate] Runs migrated: ${migrated.length} (skipped ${skipped.length} already in sessions)`,
    );
    if (migrated.length) {
      console.log(`[migrate] Migrated runIds: ${migrated.join(", ")}`);
    }
    if (skipped.length) {
      console.log(`[migrate] Already migrated runIds: ${skipped.join(", ")}`);
    }
    console.log(
      `[migrate] index.json rewritten with ${payload.sessions.length} session entries (version ${payload.version})`,
    );
  } finally {
    await releaseLock();
  }
}

await main();
