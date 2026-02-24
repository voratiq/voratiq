import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

import type { DenialBackoffConfig } from "../../configs/sandbox/types.js";
import {
  DenialBackoffTracker,
  parseSandboxDenialLine,
  resolveDenialBackoffConfig,
  type SandboxFailFastInfo,
} from "./sandbox.js";

/**
 * Watchdog types and constants for enforcing per-agent process timeouts.
 *
 * Watchdog enforcement prevents hung agent binaries from blocking the entire
 * voratiq run pipeline by enforcing silence, wall-clock, and fatal pattern limits.
 */

export type WatchdogTrigger =
  | "silence"
  | "wall-clock"
  | "fatal-pattern"
  | "sandbox-denial";
export type WatchdogOutputSource = "stdout" | "stderr";

export const WATCHDOG_DEFAULTS = {
  silenceTimeoutMs: 15 * 60 * 1000,
  wallClockCapMs: 120 * 60 * 1000,
  killGraceMs: 5 * 1000,
  fatalRetryWindowMs: 60 * 1000,
  /** Hard abort timeout after SIGKILL (ensures process promise resolves). */
  hardAbortMs: 10 * 1000,
} as const;

interface FatalPatternRule {
  pattern: RegExp;
  requiresProviderErrorContext?: boolean;
  allowedSources?: readonly WatchdogOutputSource[];
}

const FATAL_PATTERN_RULES: ReadonlyMap<string, FatalPatternRule[]> = new Map([
  [
    "gemini",
    [
      { pattern: /PERMISSION_DENIED/i },
      { pattern: /RESOURCE_EXHAUSTED/i },
      { pattern: /MODEL_CAPACITY_EXHAUSTED/i },
      { pattern: /No capacity available for model/i },
    ],
  ],
  [
    "codex",
    [
      { pattern: /invalid_request_error/i, requiresProviderErrorContext: true },
      { pattern: /unsupported_value/i, requiresProviderErrorContext: true },
      {
        pattern: /^\s*thread\s+.+\s+panicked at\b/i,
        allowedSources: ["stderr"],
      },
    ],
  ],
  [
    "claude",
    [
      { pattern: /OAuth token revoked/i },
      { pattern: /OAuth token has expired/i },
      { pattern: /Please run \/login/i },
      { pattern: /invalid.*api.*key/i },
      { pattern: /insufficient_quota/i },
    ],
  ],
]);

export const FATAL_PATTERNS: ReadonlyMap<string, RegExp[]> = new Map(
  Array.from(FATAL_PATTERN_RULES, ([providerId, rules]) => [
    providerId,
    rules.map((rule) => rule.pattern),
  ]),
);

export interface WatchdogResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
  watchdogTrigger?: WatchdogTrigger;
}

export interface WatchdogOptions {
  providerId: string;
  denialBackoff?: DenialBackoffConfig;
  onWatchdogTrigger?: (
    trigger: WatchdogTrigger,
    reason: string,
    failFast?: SandboxFailFastInfo,
  ) => void;
}

interface WatchdogState {
  silenceTimer: ReturnType<typeof setTimeout> | null;
  wallClockTimer: ReturnType<typeof setTimeout> | null;
  killGraceTimer: ReturnType<typeof setTimeout> | null;
  hardAbortTimer: ReturnType<typeof setTimeout> | null;
  fatalPatternFirstSeen: number | null;
  fatalLineBufferBySource: Record<WatchdogOutputSource, string>;
  fatalCurrentLineMatchedBySource: Record<WatchdogOutputSource, boolean>;
  triggered: WatchdogTrigger | null;
  triggeredReason: string | null;
  sandboxFailFast: SandboxFailFastInfo | null;
  denialBackoff: DenialBackoffTracker;
  sandboxLineBufferBySource: Record<WatchdogOutputSource, string>;
  delayInProgress: boolean;
  abortController: AbortController;
}

function hasCodexErrorContext(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (
    /^\s*(?:openai|codex)(?:\s+api)?\s+error\b/i.test(trimmed) ||
    /^\s*api\s+error\b/i.test(trimmed)
  ) {
    return true;
  }

  if (
    /^\s*\{.*"error"\s*:/i.test(trimmed) ||
    /^\s*"error"\s*:/i.test(trimmed)
  ) {
    return true;
  }

  if (
    /^\s*\{.*"type"\s*:\s*"invalid_request_error"/i.test(trimmed) ||
    /^\s*"type"\s*:\s*"invalid_request_error"/i.test(trimmed)
  ) {
    return true;
  }

  if (
    /^\s*\{.*"code"\s*:\s*"unsupported_value"/i.test(trimmed) ||
    /^\s*"code"\s*:\s*"unsupported_value"/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

function hasProviderErrorContext(providerId: string, line: string): boolean {
  if (providerId === "codex") {
    return hasCodexErrorContext(line);
  }
  return true;
}

function findFatalPatternMatch(
  providerId: string,
  line: string,
  source: WatchdogOutputSource,
  rules: readonly FatalPatternRule[],
): RegExp | undefined {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return undefined;
  }

  for (const rule of rules) {
    if (
      rule.allowedSources &&
      !rule.allowedSources.some((allowedSource) => allowedSource === source)
    ) {
      continue;
    }
    if (!rule.pattern.test(trimmedLine)) {
      continue;
    }
    if (
      rule.requiresProviderErrorContext &&
      !hasProviderErrorContext(providerId, trimmedLine)
    ) {
      continue;
    }
    return rule.pattern;
  }

  return undefined;
}

export function createWatchdog(
  child: ChildProcess,
  stderrStream: Writable,
  options: WatchdogOptions,
): WatchdogController {
  const { silenceTimeoutMs, wallClockCapMs, killGraceMs, hardAbortMs } =
    WATCHDOG_DEFAULTS;

  const denialBackoff = resolveDenialBackoffConfig(options.denialBackoff);

  const state: WatchdogState = {
    silenceTimer: null,
    wallClockTimer: null,
    killGraceTimer: null,
    hardAbortTimer: null,
    fatalPatternFirstSeen: null,
    fatalLineBufferBySource: {
      stdout: "",
      stderr: "",
    },
    fatalCurrentLineMatchedBySource: {
      stdout: false,
      stderr: false,
    },
    triggered: null,
    triggeredReason: null,
    sandboxFailFast: null,
    denialBackoff: new DenialBackoffTracker(denialBackoff),
    sandboxLineBufferBySource: {
      stdout: "",
      stderr: "",
    },
    delayInProgress: false,
    abortController: new AbortController(),
  };

  const fatalPatternRules = FATAL_PATTERN_RULES.get(options.providerId) ?? [];

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

  const triggerWatchdog = (
    trigger: WatchdogTrigger,
    reason: string,
    failFast?: SandboxFailFastInfo,
  ): void => {
    if (state.triggered) {
      return;
    }
    state.triggered = trigger;
    state.triggeredReason = reason;
    if (failFast) {
      state.sandboxFailFast = failFast;
    }
    clearAllTimers();

    const banner = formatWatchdogBanner(trigger, reason);
    stderrStream.write(banner);

    if (options.onWatchdogTrigger) {
      options.onWatchdogTrigger(trigger, reason, failFast);
    }

    terminateProcess(child, state, { killGraceMs, hardAbortMs });
  };

  const registerFatalPatternMatch = (): void => {
    const now = Date.now();
    if (state.fatalPatternFirstSeen === null) {
      state.fatalPatternFirstSeen = now;
      return;
    }
    const elapsed = now - state.fatalPatternFirstSeen;
    if (elapsed <= WATCHDOG_DEFAULTS.fatalRetryWindowMs) {
      triggerWatchdog(
        "fatal-pattern",
        "Fatal provider error detected repeatedly. Inspect `stderr.log` for details.",
      );
    }
  };

  const checkFatalPatternLine = (
    line: string,
    source: WatchdogOutputSource,
  ): boolean => {
    if (state.triggered || fatalPatternRules.length === 0) {
      return false;
    }

    const pattern = findFatalPatternMatch(
      options.providerId,
      line,
      source,
      fatalPatternRules,
    );
    if (!pattern) {
      return false;
    }

    registerFatalPatternMatch();
    return true;
  };

  const checkFatalPattern = (
    text: string,
    source: WatchdogOutputSource,
  ): void => {
    if (state.triggered || fatalPatternRules.length === 0) {
      return;
    }

    state.fatalLineBufferBySource[source] += text;
    const lines = state.fatalLineBufferBySource[source].split(/\r?\n/);
    state.fatalLineBufferBySource[source] = lines.pop() ?? "";
    const hadMatchedTrailingPartial =
      state.fatalCurrentLineMatchedBySource[source];

    for (const [index, line] of lines.entries()) {
      if (state.triggered) {
        return;
      }

      // If the trailing partial line was already matched in a prior chunk,
      // skip exactly its completed replay on this chunk boundary.
      if (hadMatchedTrailingPartial && index === 0) {
        continue;
      }

      checkFatalPatternLine(line, source);
    }

    if (lines.length > 0) {
      state.fatalCurrentLineMatchedBySource[source] = false;
    }

    if (state.triggered) {
      return;
    }
    if (!state.fatalLineBufferBySource[source]) {
      state.fatalCurrentLineMatchedBySource[source] = false;
      return;
    }
    if (!state.fatalCurrentLineMatchedBySource[source]) {
      state.fatalCurrentLineMatchedBySource[source] = checkFatalPatternLine(
        state.fatalLineBufferBySource[source],
        source,
      );
    }
  };

  const handleOutput = (
    chunk: Buffer | string,
    source: WatchdogOutputSource = "stderr",
  ): void => {
    resetSilenceTimer();
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    checkFatalPattern(text, source);
    handleSandboxDenialText(text, source);
  };

  const handleSandboxDenialText = (
    text: string,
    source: WatchdogOutputSource,
  ): void => {
    if (state.triggered) {
      return;
    }

    state.sandboxLineBufferBySource[source] += text;
    const lines = state.sandboxLineBufferBySource[source].split("\n");
    state.sandboxLineBufferBySource[source] = lines.pop() ?? "";

    for (const line of lines) {
      if (state.triggered) {
        return;
      }

      if (line.startsWith("Running: ")) {
        state.denialBackoff.resetAll();
        continue;
      }

      const denial = parseSandboxDenialLine(line);
      if (!denial) {
        continue;
      }

      const decision = state.denialBackoff.register(denial);
      if (decision.action === "warn") {
        stderrStream.write(
          `\n[SandboxBackoff: WARN] Repeated denial to ${denial.target} (count=${decision.count}).\n`,
        );
      } else if (decision.action === "delay") {
        stderrStream.write(
          `\n[SandboxBackoff: ERROR] Repeated denial to ${denial.target} (count=${decision.count}); delaying ${denialBackoff.delayMs}ms.\n`,
        );
        void applyBackoffDelay(child, state, denialBackoff);
      } else if (decision.action === "fail-fast") {
        triggerWatchdog(
          "sandbox-denial",
          `Sandbox: repeated denial to ${denial.target}, aborting to prevent resource exhaustion`,
          denial,
        );
        return;
      }
    }
  };

  const applyBackoffDelay = async (
    child: ChildProcess,
    state: WatchdogState,
    config: DenialBackoffConfig,
  ): Promise<void> => {
    if (state.delayInProgress || state.triggered) {
      return;
    }
    const pid = child.pid;
    if (pid === undefined) {
      return;
    }
    state.delayInProgress = true;
    const delayMs = config.delayMs;
    killProcessGroup(pid, "SIGSTOP");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      timer.unref();
    });
    if (!state.triggered) {
      killProcessGroup(pid, "SIGCONT");
    }
    state.delayInProgress = false;
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
      sandboxFailFast: state.sandboxFailFast ?? undefined,
    }),
    /** AbortSignal that fires after watchdog triggers and hard abort timeout passes. */
    abortSignal: state.abortController.signal,
  };
}

export interface WatchdogController {
  handleOutput: (chunk: Buffer | string, source?: WatchdogOutputSource) => void;
  cleanup: () => void;
  getState: () => {
    triggered: WatchdogTrigger | null;
    triggeredReason: string | null;
    sandboxFailFast?: SandboxFailFastInfo;
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
