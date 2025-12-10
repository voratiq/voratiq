import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

/**
 * Watchdog types and constants for enforcing per-agent process timeouts.
 *
 * Watchdog enforcement prevents hung agent binaries from blocking the entire
 * voratiq run pipeline by enforcing silence, wall-clock, and fatal pattern limits.
 */

export type WatchdogTrigger = "silence" | "wall-clock" | "fatal-pattern";

export const WATCHDOG_DEFAULTS = {
  silenceTimeoutMs: 15 * 60 * 1000,
  wallClockCapMs: 120 * 60 * 1000,
  killGraceMs: 5 * 1000,
  fatalRetryWindowMs: 60 * 1000,
  /** Hard abort timeout after SIGKILL (ensures process promise resolves). */
  hardAbortMs: 10 * 1000,
} as const;

export const FATAL_PATTERNS: ReadonlyMap<string, RegExp[]> = new Map([
  ["gemini", [/You have exhausted your capacity on this model\./i]],
  ["codex", [/Connection failed: error sending request for url\./i]],
]);

export interface WatchdogResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
  watchdogTrigger?: WatchdogTrigger;
}

export interface WatchdogOptions {
  providerId: string;
  onWatchdogTrigger?: (trigger: WatchdogTrigger, reason: string) => void;
}

interface WatchdogState {
  silenceTimer: ReturnType<typeof setTimeout> | null;
  wallClockTimer: ReturnType<typeof setTimeout> | null;
  killGraceTimer: ReturnType<typeof setTimeout> | null;
  hardAbortTimer: ReturnType<typeof setTimeout> | null;
  fatalPatternFirstSeen: number | null;
  triggered: WatchdogTrigger | null;
  triggeredReason: string | null;
  abortController: AbortController;
}

export function createWatchdog(
  child: ChildProcess,
  stderrStream: Writable,
  options: WatchdogOptions,
): WatchdogController {
  const { silenceTimeoutMs, wallClockCapMs, killGraceMs, hardAbortMs } =
    WATCHDOG_DEFAULTS;

  const state: WatchdogState = {
    silenceTimer: null,
    wallClockTimer: null,
    killGraceTimer: null,
    hardAbortTimer: null,
    fatalPatternFirstSeen: null,
    triggered: null,
    triggeredReason: null,
    abortController: new AbortController(),
  };

  const fatalPatterns = FATAL_PATTERNS.get(options.providerId) ?? [];

  const resetSilenceTimer = (): void => {
    if (state.silenceTimer) {
      clearTimeout(state.silenceTimer);
    }
    if (state.triggered) {
      return;
    }
    const silenceMinutes = Math.round(silenceTimeoutMs / 60000);
    state.silenceTimer = setTimeout(() => {
      triggerWatchdog(
        "silence",
        `Agent produced no output for ${silenceMinutes} minute${silenceMinutes === 1 ? "" : "s"}`,
      );
    }, silenceTimeoutMs);
    state.silenceTimer.unref();
  };

  const clearAllTimers = (): void => {
    if (state.silenceTimer) {
      clearTimeout(state.silenceTimer);
      state.silenceTimer = null;
    }
    if (state.wallClockTimer) {
      clearTimeout(state.wallClockTimer);
      state.wallClockTimer = null;
    }
    if (state.killGraceTimer) {
      clearTimeout(state.killGraceTimer);
      state.killGraceTimer = null;
    }
    if (state.hardAbortTimer) {
      clearTimeout(state.hardAbortTimer);
      state.hardAbortTimer = null;
    }
  };

  const triggerWatchdog = (trigger: WatchdogTrigger, reason: string): void => {
    if (state.triggered) {
      return;
    }
    state.triggered = trigger;
    state.triggeredReason = reason;
    clearAllTimers();

    const banner = formatWatchdogBanner(trigger, reason);
    stderrStream.write(banner);

    if (options.onWatchdogTrigger) {
      options.onWatchdogTrigger(trigger, reason);
    }

    terminateProcess(child, state, { killGraceMs, hardAbortMs });
  };

  const checkFatalPattern = (text: string): void => {
    if (state.triggered || fatalPatterns.length === 0) {
      return;
    }

    for (const pattern of fatalPatterns) {
      if (pattern.test(text)) {
        const now = Date.now();
        if (state.fatalPatternFirstSeen === null) {
          state.fatalPatternFirstSeen = now;
          return;
        }
        const elapsed = now - state.fatalPatternFirstSeen;
        if (elapsed <= WATCHDOG_DEFAULTS.fatalRetryWindowMs) {
          triggerWatchdog(
            "fatal-pattern",
            `Fatal error pattern detected: ${pattern.source}`,
          );
        }
        return;
      }
    }
  };

  const handleOutput = (chunk: Buffer | string): void => {
    resetSilenceTimer();
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    checkFatalPattern(text);
  };

  resetSilenceTimer();

  const wallClockMinutes = Math.round(wallClockCapMs / 60000);
  state.wallClockTimer = setTimeout(() => {
    triggerWatchdog(
      "wall-clock",
      `Agent exceeded ${wallClockMinutes} minute wall-clock limit`,
    );
  }, wallClockCapMs);
  state.wallClockTimer.unref();

  // Clear timers early if child exits during grace window
  child.once("exit", () => {
    if (state.killGraceTimer) {
      clearTimeout(state.killGraceTimer);
      state.killGraceTimer = null;
    }
    if (state.hardAbortTimer) {
      clearTimeout(state.hardAbortTimer);
      state.hardAbortTimer = null;
    }
  });

  return {
    handleOutput,
    cleanup: clearAllTimers,
    getState: () => ({
      triggered: state.triggered,
      triggeredReason: state.triggeredReason,
    }),
    /** AbortSignal that fires after watchdog triggers and hard abort timeout passes. */
    abortSignal: state.abortController.signal,
  };
}

export interface WatchdogController {
  handleOutput: (chunk: Buffer | string) => void;
  cleanup: () => void;
  getState: () => {
    triggered: WatchdogTrigger | null;
    triggeredReason: string | null;
  };
  /** AbortSignal that fires after watchdog triggers and hard abort timeout passes. */
  abortSignal: AbortSignal;
}

function formatWatchdogBanner(
  trigger: WatchdogTrigger,
  reason: string,
): string {
  const triggerLabel = trigger.toUpperCase().replace("-", " ");
  return `\n[WATCHDOG: ${triggerLabel}] ${reason}\n`;
}

interface TerminateProcessOptions {
  killGraceMs: number;
  hardAbortMs: number;
}

/**
 * Kills the entire process group rooted at the given PID.
 * Uses negative PID to target the process group (requires detached spawn).
 * Falls back to single-process kill if group kill fails.
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative PID sends signal to entire process group
    process.kill(-pid, signal);
  } catch {
    // Fall back to single process kill if group kill fails
    // (e.g., if process was not spawned with detached: true)
    try {
      process.kill(pid, signal);
    } catch {
      // Process may have already exited, ignore
    }
  }
}

function terminateProcess(
  child: ChildProcess,
  state: WatchdogState,
  options: TerminateProcessOptions,
): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  // Kill entire process group to prevent orphaned child processes
  killProcessGroup(pid, "SIGTERM");

  state.killGraceTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      // Kill entire process group with SIGKILL
      killProcessGroup(pid, "SIGKILL");
    }
    state.killGraceTimer = null;

    // Set hard abort timer - fires abort signal if child still doesn't exit
    state.hardAbortTimer = setTimeout(() => {
      state.hardAbortTimer = null;
      state.abortController.abort();
    }, options.hardAbortMs);
    state.hardAbortTimer.unref();
  }, options.killGraceMs);
  state.killGraceTimer.unref();
}
