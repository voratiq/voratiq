import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { RunProcessStreamError } from "../../src/commands/run/errors.js";
import { spawnStreamingProcess } from "../../src/utils/process.js";

jest.mock("node:child_process", () => ({
  spawn: jest.fn(),
}));
const spawnMock = jest.mocked(spawn);

type MockChild = EventEmitter &
  Pick<ChildProcess, "stdout" | "stderr" | "stdin" | "pid" | "kill">;

function stubProcessEnv(env: NodeJS.ProcessEnv): () => void {
  const originalEnv = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return () => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  };
}

function createChildProcess(options: { withStdin?: boolean } = {}): MockChild {
  const child = new EventEmitter() as MockChild;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdout = stdout as MockChild["stdout"];
  child.stderr = stderr as MockChild["stderr"];
  if (options.withStdin !== false) {
    const stdin = new PassThrough();
    jest.spyOn(stdin, "end");
    child.stdin = stdin as MockChild["stdin"];
  }
  return child;
}

describe("spawnStreamingProcess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pipes stdout/stderr and merges env overrides", async () => {
    const restoreEnv = stubProcessEnv({
      PATH: "/usr/local/bin",
      HOME: "/Users/tester",
      LC_ALL: "en_US.UTF-8",
      AWS_ACCESS_KEY_ID: "DO-NOT-PROPAGATE",
    });

    try {
      const child = createChildProcess();
      spawnMock.mockReturnValue(child as unknown as ChildProcess);

      const stdoutTarget = new PassThrough();
      const stderrTarget = new PassThrough();
      let capturedStdout = "";
      let capturedStderr = "";
      stdoutTarget.setEncoding("utf8");
      stderrTarget.setEncoding("utf8");
      stdoutTarget.on("data", (chunk: string) => {
        capturedStdout += chunk;
      });
      stderrTarget.on("data", (chunk: string) => {
        capturedStderr += chunk;
      });

      const promise = spawnStreamingProcess({
        command: "echo",
        cwd: "/repo",
        env: { CUSTOM_FLAG: "1" },
        stdout: { writable: stdoutTarget },
        stderr: { writable: stderrTarget },
      });

      (child.stdout as PassThrough | null)?.write("output\n");
      (child.stdout as PassThrough | null)?.end();
      (child.stderr as PassThrough | null)?.write("warning\n");
      (child.stderr as PassThrough | null)?.end();
      child.emit("close", 0, null);

      const result = await promise;

      expect(result).toEqual({ exitCode: 0, signal: null });
      expect(capturedStdout).toContain("output");
      expect(capturedStderr).toContain("warning");
      expect(spawnMock).toHaveBeenCalledWith("echo", [], expect.anything());
      const spawnOptions = spawnMock.mock.calls.at(-1)?.[2];
      expect(spawnOptions).toMatchObject({
        cwd: "/repo",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect(spawnOptions?.env).toEqual({
        PATH: "/usr/local/bin",
        HOME: "/Users/tester",
        LC_ALL: "en_US.UTF-8",
        CUSTOM_FLAG: "1",
      });
      expect(spawnOptions?.env).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    } finally {
      restoreEnv();
    }
  });

  it("forwards stdin when provided", async () => {
    const child = createChildProcess();
    const endSpy = jest.spyOn(child.stdin!, "end");
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const promise = spawnStreamingProcess({
      command: "cat",
      cwd: "/repo",
      stdin: "payload",
      stdout: { writable: new PassThrough(), endOnClose: true },
      stderr: { writable: new PassThrough(), endOnClose: true },
    });

    child.emit("close", 0, null);
    await promise;

    expect(endSpy).toHaveBeenCalledWith("payload");
  });

  it("rejects when stdin is requested but unavailable", async () => {
    const child = createChildProcess({ withStdin: false });
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    await expect(
      spawnStreamingProcess({
        command: "cat",
        cwd: "/repo",
        stdin: Buffer.from("data"),
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
      }),
    ).rejects.toThrow(RunProcessStreamError);
  });

  it("propagates errors thrown by spawn", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failure");
    });

    await expect(
      spawnStreamingProcess({
        command: "echo",
        cwd: "/repo",
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
      }),
    ).rejects.toThrow("spawn failure");
  });

  it("keeps prefixed VORATIQ env vars while removing sensitive defaults", async () => {
    const restoreEnv = stubProcessEnv({
      PATH: "/bin",
      AWS_SESSION_TOKEN: "secret",
    });
    try {
      const child = createChildProcess();
      spawnMock.mockReturnValue(child as unknown as ChildProcess);

      const promise = spawnStreamingProcess({
        command: "echo",
        cwd: "/repo",
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
      });

      child.emit("close", 0, null);
      await promise;

      const spawnOptions = spawnMock.mock.calls.at(-1)?.[2];
      expect(spawnOptions?.env).toMatchObject({
        PATH: "/bin",
      });
      expect(spawnOptions?.env).not.toHaveProperty("AWS_SESSION_TOKEN");
    } finally {
      restoreEnv();
    }
  });

  describe("abortSignal", () => {
    it("should force-resolve with aborted=true when signal fires", async () => {
      const child = createChildProcess();
      spawnMock.mockReturnValue(child as unknown as ChildProcess);

      const abortController = new AbortController();
      const promise = spawnStreamingProcess({
        command: "sleep",
        args: ["100"],
        cwd: "/repo",
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
        abortSignal: abortController.signal,
      });

      // Fire the abort signal before child exits
      abortController.abort();

      const result = await promise;

      expect(result.aborted).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.signal).toBe("SIGKILL");
    });

    it("should handle pre-aborted signal immediately", async () => {
      const child = createChildProcess();
      spawnMock.mockReturnValue(child as unknown as ChildProcess);

      const abortController = new AbortController();
      abortController.abort(); // Abort before calling spawnStreamingProcess

      const promise = spawnStreamingProcess({
        command: "sleep",
        args: ["100"],
        cwd: "/repo",
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
        abortSignal: abortController.signal,
      });

      const result = await promise;

      expect(result.aborted).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.signal).toBe("SIGKILL");
    });

    it("should not set aborted when child exits normally without abort signal", async () => {
      const child = createChildProcess();
      spawnMock.mockReturnValue(child as unknown as ChildProcess);

      const abortController = new AbortController();
      const promise = spawnStreamingProcess({
        command: "echo",
        cwd: "/repo",
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
        abortSignal: abortController.signal,
      });

      // Normal exit before abort
      child.emit("close", 0, null);

      const result = await promise;

      expect(result.aborted).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
    });

    it("should ignore abort signal if process already exited", async () => {
      const child = createChildProcess();
      spawnMock.mockReturnValue(child as unknown as ChildProcess);

      const abortController = new AbortController();
      const promise = spawnStreamingProcess({
        command: "echo",
        cwd: "/repo",
        stdout: { writable: new PassThrough() },
        stderr: { writable: new PassThrough() },
        abortSignal: abortController.signal,
      });

      // Child exits first
      child.emit("close", 42, null);

      // Then abort fires (should be ignored)
      abortController.abort();

      const result = await promise;

      expect(result.aborted).toBeUndefined();
      expect(result.exitCode).toBe(42);
    });
  });
});
