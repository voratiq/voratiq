import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import type { StagedAuthContext } from "../../../src/agents/runtime/auth.js";
import {
  registerSessionProcess,
  registerStagedAuthContext,
  teardownRegisteredAuthContext,
  teardownSessionAuth,
  terminateSessionProcesses,
} from "../../../src/agents/runtime/registry.js";
import type { AuthProvider } from "../../../src/auth/providers/types.js";
import { pathExists } from "../../../src/utils/fs.js";

const tempRoots: string[] = [];
const registeredRuns = new Set<string>();

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );

  const pendingRuns = Array.from(registeredRuns);
  registeredRuns.clear();

  await Promise.all(
    pendingRuns.map(async (runId) => {
      await terminateSessionProcesses(runId);
      await teardownSessionAuth(runId).catch(() => {});
    }),
  );
});

describe("auth registry", () => {
  it("removes sandbox directories after normal completion", async () => {
    const { context, sandboxPath, providerTeardown } =
      await createSandboxContext("alpha");
    registeredRuns.add("run-normal");
    registerStagedAuthContext("run-normal", context);

    await teardownRegisteredAuthContext("run-normal", context);

    expect(providerTeardown).toHaveBeenCalledTimes(1);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);

    await expect(teardownSessionAuth("run-normal")).resolves.toBeUndefined();
  });

  it("tears down every registered sandbox when flushing a run", async () => {
    const contexts = await Promise.all([
      createSandboxContext("alpha"),
      createSandboxContext("beta"),
    ]);

    for (const { context } of contexts) {
      registeredRuns.add("run-pending");
      registerStagedAuthContext("run-pending", context);
    }

    await teardownSessionAuth("run-pending");

    for (const { sandboxPath, providerTeardown } of contexts) {
      expect(providerTeardown).toHaveBeenCalledTimes(1);
      await expect(pathExists(sandboxPath)).resolves.toBe(false);
    }
  });

  it("terminates registered detached session processes", async () => {
    const child = createMockChildProcess(4242);
    const killSpy = jest.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === -4242 || pid === 4242) {
        Object.assign(child as { signalCode: NodeJS.Signals | null }, {
          signalCode: "SIGTERM",
        });
        child.emit("exit", null, "SIGTERM");
      }
      return true;
    });

    registeredRuns.add("run-processes");
    registerSessionProcess("run-processes", child);

    await terminateSessionProcesses("run-processes");
    await terminateSessionProcesses("run-processes");

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");

    killSpy.mockRestore();
  });
});

function createMockChildProcess(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  Object.assign(child, {
    pid,
    exitCode: null,
    signalCode: null,
  });
  return child;
}

async function createSandboxContext(agentId: string): Promise<{
  context: StagedAuthContext;
  sandboxPath: string;
  providerTeardown: jest.MockedFunction<NonNullable<AuthProvider["teardown"]>>;
}> {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), `voratiq-sandbox-${agentId}-`),
  );
  tempRoots.push(sandboxRoot);
  const sandboxPath = join(sandboxRoot, "sandbox");
  await mkdir(sandboxPath, { recursive: true });
  await writeFile(join(sandboxPath, "token"), "secret", "utf8");

  const providerTeardown: jest.MockedFunction<
    NonNullable<AuthProvider["teardown"]>
  > = jest.fn(() => Promise.resolve());

  const provider: AuthProvider = {
    id: `${agentId}-provider`,
    verify: () => Promise.resolve({ status: "ok" }),
    stage: () =>
      Promise.resolve({
        sandboxPath,
        env: {},
      }),
    teardown: providerTeardown,
  };

  const context: StagedAuthContext = {
    provider,
    sandboxPath,
    runtime: {
      platform: process.platform,
      env: {},
      homeDir: sandboxRoot,
      username: "tester",
    },
    agentId,
  };

  return {
    context,
    sandboxPath,
    providerTeardown,
  };
}
