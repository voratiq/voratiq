import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

import { RunProcessStreamError } from "../commands/run/errors.js";
import { composeRestrictedEnvironment } from "./env.js";

export interface StreamTarget {
  writable: Writable;
  endOnClose?: boolean;
}

export interface SpawnStreamingProcessOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  stdin?: string | Buffer;
  stdout: StreamTarget;
  stderr: StreamTarget;
  /** Optional callback invoked for each chunk of stdout/stderr data. */
  onData?: (chunk: Buffer) => void;
  /** Optional callback invoked when the process is spawned, providing the child process. */
  onSpawn?: (child: import("node:child_process").ChildProcess) => void;
  /**
   * Optional AbortSignal to force-resolve the process promise even if the child
   * hasn't exited. Used by the watchdog to ensure bounded termination.
   */
  abortSignal?: AbortSignal;
  /**
   * If true, spawn the child in a new process group. This enables killing
   * the entire process tree by sending signals to the negative PID.
   * Required for proper cleanup of agent child processes on watchdog termination.
   */
  detached?: boolean;
}

export interface SpawnStreamingProcessResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  /** True if the process was force-aborted via AbortSignal before natural exit. */
  aborted?: boolean;
}

export async function spawnStreamingProcess(
  options: SpawnStreamingProcessOptions,
): Promise<SpawnStreamingProcessResult> {
  const {
    command,
    args = [],
    cwd,
    env,
    shell = false,
    stdin,
    stdout,
    stderr,
    onData,
    onSpawn,
    abortSignal,
    detached = false,
  } = options;

  return await new Promise<SpawnStreamingProcessResult>((resolve, reject) => {
    let resolved = false;

    const child = spawn(command, args, {
      cwd,
      env: buildSpawnEnvironment(env),
      shell,
      stdio: ["pipe", "pipe", "pipe"],
      detached,
    });

    if (onSpawn) {
      onSpawn(child);
    }

    const childStdout = child.stdout;
    const childStderr = child.stderr;
    const childStdin = child.stdin;

    if (!childStdout || !childStderr) {
      void finalizeStreams([stdout, stderr], true);
      reject(
        new RunProcessStreamError("Failed to capture process output streams"),
      );
      return;
    }

    if (onData) {
      childStdout.on("data", onData);
      childStderr.on("data", onData);
    }

    childStdout.pipe(stdout.writable, { end: false });
    childStderr.pipe(stderr.writable, { end: false });

    if (stdin !== undefined) {
      if (childStdin) {
        childStdin.end(stdin);
      } else {
        childStdout.unpipe(stdout.writable);
        childStderr.unpipe(stderr.writable);
        void finalizeStreams([stdout, stderr], true);
        reject(new RunProcessStreamError("Process does not expose stdin"));
        return;
      }
    } else if (childStdin) {
      childStdin.end();
    }

    const finalize = async (forceEnd: boolean): Promise<void> => {
      childStdout.unpipe(stdout.writable);
      childStderr.unpipe(stderr.writable);
      await finalizeStreams([stdout, stderr], forceEnd);
    };

    // Handle abort signal for force-termination after watchdog timeout
    const handleAbort = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      // Don't wait for stream finalization on force abort - resolve immediately
      // to ensure bounded termination. Streams will be cleaned up by caller.
      childStdout.unpipe(stdout.writable);
      childStderr.unpipe(stderr.writable);
      resolve({ exitCode: 1, signal: "SIGKILL", aborted: true });
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        handleAbort();
        return;
      }
      abortSignal.addEventListener("abort", handleAbort, { once: true });
    }

    child.on("error", (error: Error) => {
      if (resolved) {
        return;
      }
      resolved = true;
      abortSignal?.removeEventListener("abort", handleAbort);
      void finalize(true).finally(() => {
        reject(error);
      });
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      abortSignal?.removeEventListener("abort", handleAbort);
      void finalize(false).finally(() => {
        resolve({ exitCode: code ?? 0, signal });
      });
    });
  });
}

function buildSpawnEnvironment(
  overrides?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return composeRestrictedEnvironment(overrides);
}

async function finalizeStreams(
  targets: StreamTarget[],
  forceEnd: boolean,
): Promise<void> {
  const streams = new Map<Writable, boolean>();
  for (const target of targets) {
    const shouldEnd = forceEnd || target.endOnClose !== false;
    const previous = streams.get(target.writable) ?? false;
    streams.set(target.writable, previous || shouldEnd);
  }

  const closures: Promise<void>[] = [];

  for (const [stream, shouldEnd] of streams) {
    if (!shouldEnd) {
      continue;
    }
    closures.push(waitForWritableClosure(stream));
    try {
      stream.end();
    } catch {
      // Ignore errors raised while ending the writable; the closure promise
      // will resolve once the stream reports its terminal state.
    }
  }

  if (closures.length > 0) {
    await Promise.all(closures);
  }
}

function waitForWritableClosure(stream: Writable): Promise<void> {
  const state = stream as Writable & { closed?: boolean };
  if (
    state.destroyed ||
    state.writableFinished ||
    state.writableEnded ||
    state.closed
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const cleanup = (): void => {
      stream.removeListener("close", handleClose);
      stream.removeListener("finish", handleFinish);
      stream.removeListener("error", handleError);
    };

    const handleComplete = (): void => {
      cleanup();
      resolve();
    };

    const handleClose = (): void => {
      handleComplete();
    };

    const handleFinish = (): void => {
      handleComplete();
    };

    const handleError = (): void => {
      handleComplete();
    };

    stream.once("close", handleClose);
    stream.once("finish", handleFinish);
    stream.once("error", handleError);
  });
}
