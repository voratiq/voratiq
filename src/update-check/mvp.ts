import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isNewerVersion } from "./semver.js";

const REGISTRY_URL = "https://registry.npmjs.org/voratiq/latest";
const FETCH_TIMEOUT_MS = 1500;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface StartOptions {
  isTty: boolean;
  env: NodeJS.ProcessEnv;
  cachePath: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export interface UpdateHandle {
  peekNotice(): string | undefined;
  finish(): void;
}

interface CacheState {
  lastCheckedAt: string;
  latestVersion: string;
}

export function readCache(cachePath: string): CacheState | undefined {
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.lastCheckedAt === "string" &&
      typeof parsed.latestVersion === "string"
    ) {
      return {
        lastCheckedAt: parsed.lastCheckedAt,
        latestVersion: parsed.latestVersion,
      };
    }
  } catch {
    // Missing file, parse error, etc. - all non-actionable.
  }
  return undefined;
}

export function writeCache(cachePath: string, state: CacheState): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  } catch {
    // Write failure is non-actionable.
  }
}

function isCacheFresh(cache: CacheState, now: Date): boolean {
  try {
    const checkedAt = new Date(cache.lastCheckedAt);
    return now.getTime() - checkedAt.getTime() < CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

function buildNotice(localVersion: string, latestVersion: string): string {
  return `Update available: Voratiq ${localVersion} -> ${latestVersion}`;
}

async function fetchLatestVersion(
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    const response = await fetchImpl(REGISTRY_URL, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.version === "string" && body.version.length > 0) {
      return body.version;
    }
  } catch {
    // Network error, timeout, invalid JSON - all silent.
  }
  return undefined;
}

/**
 * Start the update check. Returns undefined when trigger rules fail
 * (non-TTY or CI). Otherwise returns a handle that can peek at cached
 * notices and perform background bookkeeping via finish().
 */
export function startUpdateCheck(
  localVersion: string,
  opts: StartOptions,
): UpdateHandle | undefined {
  // Trigger rules: skip in non-TTY or CI environments
  if (!opts.isTty) {
    return undefined;
  }

  const ciValue = opts.env.CI;
  if (ciValue && ciValue !== "0" && ciValue !== "false" && ciValue !== "") {
    return undefined;
  }

  const now = opts.now ?? (() => new Date());
  const fetchFn = opts.fetchImpl ?? fetch;
  const { cachePath } = opts;

  // Read cache synchronously at startup
  const cache = readCache(cachePath);

  // Start background refresh if cache is stale or missing
  let backgroundPromise: Promise<void> | undefined;
  if (!cache || !isCacheFresh(cache, now())) {
    backgroundPromise = fetchLatestVersion(fetchFn).then((version) => {
      if (version) {
        writeCache(cachePath, {
          lastCheckedAt: now().toISOString(),
          latestVersion: version,
        });
      }
    });

    // Ensure unhandled rejections are swallowed
    backgroundPromise.catch(() => {});
  }

  let consumed = false;

  return {
    peekNotice(): string | undefined {
      if (consumed) {
        return undefined;
      }
      if (!cache) {
        return undefined;
      }
      if (!isNewerVersion(localVersion, cache.latestVersion)) {
        return undefined;
      }
      consumed = true;
      return buildNotice(localVersion, cache.latestVersion);
    },

    finish(): void {
      // Bookkeeping only - no output. The background fetch promise
      // resolves on its own; this is a hook for future cleanup.
    },
  };
}
