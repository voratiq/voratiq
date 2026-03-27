import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { AgentRuntimeProcessError } from "../../../../src/agents/runtime/errors.js";
import {
  runAgentProcess,
  stageManifestForSandbox,
} from "../../../../src/agents/runtime/launcher.js";
import * as watchdogModule from "../../../../src/agents/runtime/watchdog.js";
import * as cliRootModule from "../../../../src/utils/cli-root.js";
import * as processModule from "../../../../src/utils/process.js";

const TEMP_DIR_PREFIX = "sandbox-launcher-test-";

// Type for the cleanup spy; jest.Mock with a function signature
type CleanupSpy = jest.Mock<() => void>;

describe("stageManifestForSandbox", () => {
  it("throws when the manifest JSON is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
    const runtimeManifestPath = join(dir, "agent.json");
    await writeFile(runtimeManifestPath, "{ invalid json", "utf8");

    await expect(
      stageManifestForSandbox({
        runtimeManifestPath,
      }),
    ).rejects.toBeInstanceOf(AgentRuntimeProcessError);
  });

  it("resolves manifest paths in place without creating a sandbox copy", async () => {
    const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
    const runtimeDir = join(dir, "runtime");
    const runtimeManifestPath = join(runtimeDir, "manifest.json");
    const promptPath = join(dir, "prompt.txt");
    const workspacePath = join(dir, "workspace");
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await writeFile(promptPath, "prompt", "utf8");

    const manifest = {
      binary: process.execPath,
      argv: ["--version"],
      promptPath: "../prompt.txt",
      workspace: "../workspace",
      env: {},
    } satisfies Record<string, unknown>;
    await writeFile(
      runtimeManifestPath,
      `${JSON.stringify(manifest)}\n`,
      "utf8",
    );

    const stagedPath = await stageManifestForSandbox({ runtimeManifestPath });
    expect(stagedPath).toBe(runtimeManifestPath);

    const parsed = JSON.parse(await readFile(runtimeManifestPath, "utf8")) as {
      promptPath: string;
      workspace: string;
    };
    expect(parsed.promptPath).toBe(promptPath);
    expect(parsed.workspace).toBe(workspacePath);

    const orphanedSandboxManifest = join(dir, "sandbox", "manifest.json");
    await expect(access(orphanedSandboxManifest)).rejects.toHaveProperty(
      "code",
      "ENOENT",
    );
  });
});

describe("runAgentProcess watchdog cleanup", () => {
  let cleanupSpy: CleanupSpy;
  let createWatchdogSpy: jest.SpiedFunction<
    typeof watchdogModule.createWatchdog
  >;
  let getCliAssetPathSpy: jest.SpiedFunction<
    typeof cliRootModule.getCliAssetPath
  >;
  let spawnStreamingProcessSpy: jest.SpiedFunction<
    typeof processModule.spawnStreamingProcess
  >;

  beforeEach(() => {
    cleanupSpy = jest.fn<() => void>();
    createWatchdogSpy = jest.spyOn(watchdogModule, "createWatchdog");
    createWatchdogSpy.mockReturnValue({
      handleOutput: jest.fn(),
      cleanup: cleanupSpy,
      getState: () => ({ triggered: null, triggeredReason: null }),
      abortSignal: new AbortController().signal,
    });
    getCliAssetPathSpy = jest.spyOn(cliRootModule, "getCliAssetPath");
    spawnStreamingProcessSpy = jest.spyOn(
      processModule,
      "spawnStreamingProcess",
    );
  });

  it("cleans up the watchdog and output streams when spawn fails after start", async () => {
    const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
    const runtimeDir = join(dir, "runtime");
    const workspacePath = join(dir, "workspace");
    const promptPath = join(dir, "prompt.txt");
    const runtimeManifestPath = join(runtimeDir, "manifest.json");
    const stdoutPath = join(dir, "artifacts", "stdout.log");
    const stderrPath = join(dir, "artifacts", "stderr.log");
    const sandboxSettingsPath = join(dir, "runtime", "sandbox.json");
    const shimPath = join(dir, "run-agent-shim.mjs");

    await mkdir(runtimeDir, { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await mkdir(dirname(stdoutPath), { recursive: true });
    await writeFile(promptPath, "prompt", "utf8");
    await writeFile(shimPath, "export {};\n", "utf8");
    await writeFile(
      runtimeManifestPath,
      `${JSON.stringify(
        {
          binary: process.execPath,
          argv: ["--version"],
          promptPath,
          workspace: workspacePath,
          env: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    getCliAssetPathSpy.mockReturnValue(shimPath);

    let capturedStdout:
      | (NodeJS.WritableStream & { writableEnded?: boolean })
      | undefined;
    let capturedStderr:
      | (NodeJS.WritableStream & { writableEnded?: boolean })
      | undefined;

    spawnStreamingProcessSpy.mockImplementation((options) => {
      capturedStdout = options.stdout.writable as typeof capturedStdout;
      capturedStderr = options.stderr.writable as typeof capturedStderr;

      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, { pid: 4242, exitCode: null, signalCode: null });
      options.onSpawn?.(child);

      return Promise.reject(new Error("spawn failed"));
    });

    try {
      await expect(
        runAgentProcess({
          runtimeManifestPath,
          agentRoot: dir,
          stdoutPath,
          stderrPath,
          sandboxSettingsPath,
          resolveRunInvocation: () => ({
            command: process.execPath,
            args: ["-e", "process.exit(0)"],
          }),
        }),
      ).rejects.toThrow("spawn failed");

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(capturedStdout?.writableEnded).toBe(true);
      expect(capturedStderr?.writableEnded).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
