import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import type { SandboxFailFastInfo } from "../../../../src/agents/runtime/sandbox.js";
import {
  createWatchdog,
  FATAL_PATTERNS,
  WATCHDOG_DEFAULTS,
  type WatchdogTrigger,
} from "../../../../src/agents/runtime/watchdog.js";

describe("watchdog", () => {
  let mockChild: MockChildProcess;
  let stderrStream: PassThrough;

  class MockChildProcess extends EventEmitter {
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public killed = false;
    public pid: number = 12345;

    public kill(signal: NodeJS.Signals): boolean {
      this.killed = true;
      if (signal === "SIGKILL") {
        this.signalCode = signal;
      }
      return true;
    }
  }

  // Track process.kill calls to verify process group killing
  let processKillCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalProcessKill = process.kill;

  beforeEach(() => {
    processKillCalls = [];
    // Mock process.kill to track calls (including negative PIDs for process groups)
    process.kill = jest.fn((pid: number, signal?: NodeJS.Signals | number) => {
      processKillCalls.push({
        pid,
        signal: (signal ?? "SIGTERM") as NodeJS.Signals,
      });
      // Simulate success for positive PIDs, throw ESRCH for negative (no such process group in test)
      if (pid < 0) {
        const error = new Error("ESRCH") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return true;
    }) as typeof process.kill;
  });

  afterEach(() => {
    process.kill = originalProcessKill;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockChild = new MockChildProcess();
    stderrStream = new PassThrough();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("WATCHDOG_DEFAULTS", () => {
    it("should have 15 minute silence timeout", () => {
      expect(WATCHDOG_DEFAULTS.silenceTimeoutMs).toBe(15 * 60 * 1000);
    });

    it("should have 120 minute wall-clock cap", () => {
      expect(WATCHDOG_DEFAULTS.wallClockCapMs).toBe(120 * 60 * 1000);
    });

    it("should have 5 second kill grace period", () => {
      expect(WATCHDOG_DEFAULTS.killGraceMs).toBe(5 * 1000);
    });

    it("should have 60 second fatal retry window", () => {
      expect(WATCHDOG_DEFAULTS.fatalRetryWindowMs).toBe(60 * 1000);
    });

    it("should have 10 second hard abort timeout", () => {
      expect(WATCHDOG_DEFAULTS.hardAbortMs).toBe(10 * 1000);
    });
  });

  describe("FATAL_PATTERNS", () => {
    it("should have gemini patterns for permission and quota errors", () => {
      const patterns = FATAL_PATTERNS.get("gemini");
      expect(patterns).toBeDefined();
      expect(patterns!.length).toBe(4);
      expect(patterns![0].test("PERMISSION_DENIED")).toBe(true);
      expect(patterns![1].test("RESOURCE_EXHAUSTED")).toBe(true);
      expect(patterns![2].test("MODEL_CAPACITY_EXHAUSTED")).toBe(true);
      expect(patterns![3].test("No capacity available for model")).toBe(true);
    });

    it("should have codex patterns for invalid requests and panics", () => {
      const patterns = FATAL_PATTERNS.get("codex");
      expect(patterns).toBeDefined();
      expect(patterns!.length).toBe(3);
      expect(patterns![0].test("invalid_request_error")).toBe(true);
      expect(patterns![1].test("unsupported_value")).toBe(true);
      expect(patterns![2].test("thread 0 panicked")).toBe(true);
    });

    it("should have claude patterns for auth and quota errors", () => {
      const patterns = FATAL_PATTERNS.get("claude");
      expect(patterns).toBeDefined();
      expect(patterns!.length).toBe(5);
      expect(patterns![0].test("OAuth token revoked")).toBe(true);
      expect(patterns![1].test("OAuth token has expired")).toBe(true);
      expect(patterns![2].test("Please run /login")).toBe(true);
      expect(patterns![3].test("invalid_api_key")).toBe(true);
      expect(patterns![4].test("insufficient_quota")).toBe(true);
    });
  });

  describe("createWatchdog", () => {
    it("should return a controller with handleOutput, cleanup, and getState", () => {
      const controller = createWatchdog(
        mockChild as unknown as ChildProcess,
        stderrStream,
        {
          providerId: "test",
        },
      );

      expect(controller.handleOutput).toBeDefined();
      expect(controller.cleanup).toBeDefined();
      expect(controller.getState).toBeDefined();
    });

    it("should not trigger immediately on creation", () => {
      const controller = createWatchdog(
        mockChild as unknown as ChildProcess,
        stderrStream,
        {
          providerId: "test",
        },
      );

      const state = controller.getState();
      expect(state.triggered).toBeNull();
      expect(state.triggeredReason).toBeNull();
    });

    describe("silence timeout", () => {
      it("should trigger after silence timeout with no output", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
            onWatchdogTrigger: onTrigger,
          },
        );

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);

        const state = controller.getState();
        expect(state.triggered).toBe("silence");
        expect(onTrigger).toHaveBeenCalledWith(
          "silence",
          expect.stringContaining("no output"),
          undefined,
        );
        // Verify process group kill was attempted (negative PID), then fallback to single process
        expect(
          processKillCalls.some(
            (call) => call.pid === -mockChild.pid && call.signal === "SIGTERM",
          ),
        ).toBe(true);
        expect(
          processKillCalls.some(
            (call) => call.pid === mockChild.pid && call.signal === "SIGTERM",
          ),
        ).toBe(true);
      });

      it("should reset silence timer on output", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
            onWatchdogTrigger: onTrigger,
          },
        );

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs - 1000);
        controller.handleOutput(Buffer.from("some output"));
        jest.advanceTimersByTime(1001);

        expect(controller.getState().triggered).toBeNull();
        expect(onTrigger).not.toHaveBeenCalled();
      });
    });

    describe("wall-clock timeout", () => {
      it("should trigger after wall-clock cap regardless of output", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
            onWatchdogTrigger: onTrigger,
          },
        );

        const intervals = Math.ceil(
          WATCHDOG_DEFAULTS.wallClockCapMs /
            (WATCHDOG_DEFAULTS.silenceTimeoutMs - 1000),
        );
        for (let i = 0; i < intervals; i++) {
          controller.handleOutput(Buffer.from("output"));
          jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs - 1000);
        }

        const state = controller.getState();
        expect(state.triggered).toBe("wall-clock");
        expect(onTrigger).toHaveBeenCalledWith(
          "wall-clock",
          expect.stringContaining("120 minute"),
          undefined,
        );
      });
    });

    describe("fatal patterns", () => {
      it("should not trigger on first fatal pattern match (allows retry)", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "gemini",
            onWatchdogTrigger: onTrigger,
          },
        );

        controller.handleOutput(Buffer.from("Error: PERMISSION_DENIED"));

        expect(controller.getState().triggered).toBeNull();
        expect(onTrigger).not.toHaveBeenCalled();
      });

      it("should trigger on second fatal pattern match within retry window", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "gemini",
            onWatchdogTrigger: onTrigger,
          },
        );

        controller.handleOutput(Buffer.from("Error: PERMISSION_DENIED"));
        jest.advanceTimersByTime(30000);
        controller.handleOutput(Buffer.from("Error: PERMISSION_DENIED"));

        const state = controller.getState();
        expect(state.triggered).toBe("fatal-pattern");
        expect(onTrigger).toHaveBeenCalledWith(
          "fatal-pattern",
          expect.stringContaining("Fatal error"),
          undefined,
        );
        // Verify process group kill was attempted
        expect(
          processKillCalls.some(
            (call) => call.pid === -mockChild.pid && call.signal === "SIGTERM",
          ),
        ).toBe(true);
      });

      it("should not trigger if second match is outside retry window", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "gemini",
            onWatchdogTrigger: onTrigger,
          },
        );

        controller.handleOutput(Buffer.from("Error: PERMISSION_DENIED"));
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.fatalRetryWindowMs + 1000);
        controller.handleOutput(Buffer.from("Error: PERMISSION_DENIED"));

        expect(controller.getState().triggered).toBeNull();
        expect(onTrigger).not.toHaveBeenCalled();
      });

      it("should work for codex provider", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "codex",
            onWatchdogTrigger: onTrigger,
          },
        );

        controller.handleOutput(Buffer.from("Error: invalid_request_error"));
        jest.advanceTimersByTime(10000);
        controller.handleOutput(Buffer.from("Error: invalid_request_error"));

        expect(controller.getState().triggered).toBe("fatal-pattern");
      });

      it("should not check fatal patterns for unknown providers", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "unknown-provider",
            onWatchdogTrigger: onTrigger,
          },
        );

        controller.handleOutput(
          Buffer.from("You have exhausted your capacity on this model."),
        );
        controller.handleOutput(
          Buffer.from("You have exhausted your capacity on this model."),
        );

        expect(controller.getState().triggered).toBeNull();
      });
    });

    describe("cleanup", () => {
      it("should clear all timers on cleanup", () => {
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
          },
        );

        controller.cleanup();
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.wallClockCapMs + 1000);

        expect(controller.getState().triggered).toBeNull();
      });

      it("should clear grace timer when cleanup is called after watchdog triggers", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
            onWatchdogTrigger: onTrigger,
          },
        );

        // Trigger watchdog via silence timeout
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);
        // SIGTERM should have been sent to process group
        expect(processKillCalls.some((call) => call.signal === "SIGTERM")).toBe(
          true,
        );
        const termCallCount = processKillCalls.length;

        // Cleanup should clear the grace timer before it fires
        controller.cleanup();

        // Grace timer would fire SIGKILL if not cleared
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);

        // SIGKILL should NOT have been sent since cleanup cleared grace timer
        expect(
          processKillCalls.filter((call) => call.signal === "SIGKILL").length,
        ).toBe(0);
        // No additional kill calls after cleanup
        expect(processKillCalls.length).toBe(termCallCount);
      });

      it("should clear timers when cleanup is called even without watchdog trigger (simulating rejection path)", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
            onWatchdogTrigger: onTrigger,
          },
        );

        // Simulate spawn rejection path - cleanup called without trigger
        controller.cleanup();

        // Advance past all possible timer durations
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.wallClockCapMs + 1000);

        // No watchdog should have triggered
        expect(controller.getState().triggered).toBeNull();
        expect(onTrigger).not.toHaveBeenCalled();
        // No kill calls should have been made
        expect(processKillCalls.length).toBe(0);
      });
    });

    describe("SIGKILL grace period", () => {
      it("should send SIGKILL after grace period if process still running", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
          providerId: "test",
          onWatchdogTrigger: onTrigger,
        });

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);
        // Verify SIGTERM was sent to process group
        expect(processKillCalls.some((call) => call.signal === "SIGTERM")).toBe(
          true,
        );

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);
        // Verify SIGKILL was sent to process group
        expect(processKillCalls.some((call) => call.signal === "SIGKILL")).toBe(
          true,
        );
      });

      it("should clear grace timer early when child emits exit event", () => {
        const onTrigger =
          jest.fn<
            (
              trigger: WatchdogTrigger,
              reason: string,
              failFast?: SandboxFailFastInfo,
            ) => void
          >();
        createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
          providerId: "test",
          onWatchdogTrigger: onTrigger,
        });

        // Trigger watchdog
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);
        expect(processKillCalls.some((call) => call.signal === "SIGTERM")).toBe(
          true,
        );
        const termCallCount = processKillCalls.length;

        // Simulate child exiting before grace period ends
        mockChild.exitCode = 0;
        mockChild.emit("exit", 0, null);

        // Advance past grace period
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);

        // SIGKILL should NOT have been sent since child already exited
        expect(
          processKillCalls.filter((call) => call.signal === "SIGKILL").length,
        ).toBe(0);
        // No additional kill calls after exit
        expect(processKillCalls.length).toBe(termCallCount);
      });
    });

    describe("hard abort signal", () => {
      it("should expose abortSignal on controller", () => {
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
          },
        );

        expect(controller.abortSignal).toBeInstanceOf(AbortSignal);
        expect(controller.abortSignal.aborted).toBe(false);
      });

      it("should fire abortSignal after SIGKILL and hard abort timeout", () => {
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
          },
        );

        // Trigger watchdog via silence timeout
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);
        expect(processKillCalls.some((call) => call.signal === "SIGTERM")).toBe(
          true,
        );
        expect(controller.abortSignal.aborted).toBe(false);

        // Advance past kill grace period (SIGKILL sent)
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);
        expect(processKillCalls.some((call) => call.signal === "SIGKILL")).toBe(
          true,
        );
        expect(controller.abortSignal.aborted).toBe(false);

        // Advance past hard abort timeout
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.hardAbortMs);
        expect(controller.abortSignal.aborted).toBe(true);
      });

      it("should not fire abortSignal if child exits before hard abort timeout", () => {
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
          },
        );

        // Trigger watchdog
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);

        // Let SIGKILL fire
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);
        expect(processKillCalls.some((call) => call.signal === "SIGKILL")).toBe(
          true,
        );

        // Simulate child finally exiting after SIGKILL
        mockChild.exitCode = 137;
        mockChild.emit("exit", 137, "SIGKILL");

        // Advance past hard abort timeout
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.hardAbortMs);

        // abortSignal should NOT have fired since child exited
        expect(controller.abortSignal.aborted).toBe(false);
      });

      it("should clear hard abort timer on cleanup", () => {
        const controller = createWatchdog(
          mockChild as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
          },
        );

        // Trigger watchdog and let SIGKILL fire
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);
        expect(processKillCalls.some((call) => call.signal === "SIGKILL")).toBe(
          true,
        );

        // Cleanup before hard abort timer fires
        controller.cleanup();

        // Advance past hard abort timeout
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.hardAbortMs);

        // abortSignal should NOT have fired since cleanup was called
        expect(controller.abortSignal.aborted).toBe(false);
      });
    });

    describe("timer unref behavior", () => {
      it("should unref all timers so they do not block event loop exit", () => {
        // Store original setTimeout to restore later
        const originalSetTimeout = global.setTimeout;
        const unrefCalls: ReturnType<typeof setTimeout>[] = [];

        // Create a mock that tracks unref calls
        const mockSetTimeout = jest.fn(
          (
            callback: (...args: unknown[]) => void,
            ms?: number,
          ): ReturnType<typeof setTimeout> => {
            const timer = originalSetTimeout(callback, ms);
            const originalUnref = timer.unref.bind(timer);
            timer.unref = jest.fn(() => {
              unrefCalls.push(timer);
              return originalUnref();
            });
            return timer;
          },
        );

        global.setTimeout =
          mockSetTimeout as unknown as typeof global.setTimeout;

        try {
          createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
            providerId: "test",
          });

          // Should have created at least 2 timers (silence + wall-clock)
          expect(mockSetTimeout).toHaveBeenCalledTimes(2);
          // All timers should have unref called
          expect(unrefCalls.length).toBe(2);
        } finally {
          global.setTimeout = originalSetTimeout;
        }
      });
    });

    describe("stderr banner", () => {
      it("should write banner to stderr on trigger", () => {
        const written: string[] = [];
        stderrStream.write = (chunk: unknown): boolean => {
          written.push(String(chunk));
          return true;
        };

        createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
          providerId: "test",
        });

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);

        expect(written.length).toBe(1);
        expect(written[0]).toContain("[WATCHDOG: SILENCE]");
      });
    });

    describe("process group kill", () => {
      it("should attempt to kill process group with negative PID first", () => {
        createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
          providerId: "test",
        });

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);

        // First call should be to process group (negative PID)
        expect(processKillCalls[0]).toEqual({
          pid: -mockChild.pid,
          signal: "SIGTERM",
        });
        // Second call should be fallback to single process (since group kill throws in mock)
        expect(processKillCalls[1]).toEqual({
          pid: mockChild.pid,
          signal: "SIGTERM",
        });
      });

      it("should kill process group with SIGKILL after grace period", () => {
        createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
          providerId: "test",
        });

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);
        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.killGraceMs);

        // Should have SIGKILL calls to process group and fallback
        const sigkillCalls = processKillCalls.filter(
          (call) => call.signal === "SIGKILL",
        );
        expect(sigkillCalls.some((call) => call.pid === -mockChild.pid)).toBe(
          true,
        );
        expect(sigkillCalls.some((call) => call.pid === mockChild.pid)).toBe(
          true,
        );
      });

      it("should not attempt process group kill if pid is undefined", () => {
        const childWithoutPid = new MockChildProcess();
        (childWithoutPid as { pid: number | undefined }).pid = undefined;

        createWatchdog(
          childWithoutPid as unknown as ChildProcess,
          stderrStream,
          {
            providerId: "test",
          },
        );

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);

        // No kill calls should be made when pid is undefined
        expect(processKillCalls.length).toBe(0);
      });

      it("should not attempt kill if process already exited", () => {
        mockChild.exitCode = 0;

        createWatchdog(mockChild as unknown as ChildProcess, stderrStream, {
          providerId: "test",
        });

        jest.advanceTimersByTime(WATCHDOG_DEFAULTS.silenceTimeoutMs);

        // No kill calls should be made when process already exited
        expect(processKillCalls.length).toBe(0);
      });
    });
  });
});
