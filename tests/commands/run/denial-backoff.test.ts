import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, jest } from "@jest/globals";

import { createWatchdog } from "../../../src/commands/run/agents/watchdog.js";
import {
  DEFAULT_DENIAL_BACKOFF,
  DenialBackoffTracker,
  parseSandboxDenialLine,
  type SandboxFailFastInfo,
} from "../../../src/commands/run/sandbox.js";

describe("sandbox denial backoff", () => {
  it("parses sandbox-runtime debug network denials", () => {
    expect(
      parseSandboxDenialLine(
        "[SandboxDebug] Denied by config rule: registry.npmjs.org:443",
      ),
    ).toEqual({
      operation: "network-connect",
      target: "registry.npmjs.org:443",
    });
  });

  it("escalates warn -> delay -> fail-fast for repeated denials", () => {
    const tracker = new DenialBackoffTracker(DEFAULT_DENIAL_BACKOFF);
    const info: SandboxFailFastInfo = {
      operation: "network-connect",
      target: "npmjs.org:443",
    };

    expect(tracker.register(info, 0)).toMatchObject({
      action: "none",
      count: 1,
    });
    expect(tracker.register(info, 10_000)).toMatchObject({
      action: "warn",
      count: 2,
    });
    expect(tracker.register(info, 20_000)).toMatchObject({
      action: "delay",
      count: 3,
    });
    expect(tracker.register(info, 30_000)).toMatchObject({
      action: "fail-fast",
      count: 4,
    });
  });

  it("does not warn if the second denial is outside the 30s warning window", () => {
    const tracker = new DenialBackoffTracker(DEFAULT_DENIAL_BACKOFF);
    const info: SandboxFailFastInfo = {
      operation: "network-connect",
      target: "npmjs.org:443",
    };

    expect(tracker.register(info, 0).action).toBe("none");
    expect(tracker.register(info, 31_000).action).toBe("none");
  });

  it("resets a target after the 120s window expires", () => {
    const tracker = new DenialBackoffTracker(DEFAULT_DENIAL_BACKOFF);
    const info: SandboxFailFastInfo = {
      operation: "network-connect",
      target: "npmjs.org:443",
    };

    expect(tracker.register(info, 0).count).toBe(1);
    expect(tracker.register(info, 121_000)).toMatchObject({
      action: "none",
      count: 1,
    });
  });

  it("injects delay and then fail-fasts via watchdog", async () => {
    const killSpy = jest.spyOn(process, "kill").mockImplementation(() => true);

    const child = new EventEmitter() as unknown as ChildProcess;
    Object.assign(child, { pid: 4242, exitCode: null, signalCode: null });

    const stderrStream = new PassThrough();
    const stderrChunks: string[] = [];
    stderrStream.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString("utf8")),
    );

    const onWatchdogTrigger = jest.fn();

    const watchdog = createWatchdog(child, stderrStream, {
      providerId: "codex",
      denialBackoff: { ...DEFAULT_DENIAL_BACKOFF, delayMs: 5 },
      onWatchdogTrigger,
    });

    const denialLine =
      "[SandboxDebug] Denied by config rule: registry.npmjs.org:443\n";
    watchdog.handleOutput(denialLine);
    watchdog.handleOutput(denialLine);
    watchdog.handleOutput(denialLine);

    // Delay injects SIGSTOP immediately.
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGSTOP");

    await new Promise((resolve) => setTimeout(resolve, 10));

    // After delay, process resumes.
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGCONT");

    // Fourth denial triggers fail-fast and SIGTERM.
    watchdog.handleOutput(denialLine);
    expect(onWatchdogTrigger).toHaveBeenCalledWith(
      "sandbox-denial",
      expect.stringMatching(
        /Sandbox: repeated denial to registry\.npmjs\.org:443/u,
      ),
      { operation: "network-connect", target: "registry.npmjs.org:443" },
    );
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");

    expect(stderrChunks.join("")).toMatch(/SandboxBackoff: WARN/u);
    expect(stderrChunks.join("")).toMatch(/SandboxBackoff: ERROR/u);

    killSpy.mockRestore();
  });
});
