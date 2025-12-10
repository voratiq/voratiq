import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import type { AuthProvider } from "../../../src/auth/providers/types.js";
import type { StagedAuthContext } from "../../../src/commands/run/agents/auth-stage.js";
import {
  registerStagedSandboxContext,
  teardownRegisteredSandboxContext,
  teardownRunSandboxes,
} from "../../../src/commands/run/sandbox-registry.js";
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
    pendingRuns.map((runId) => teardownRunSandboxes(runId).catch(() => {})),
  );
});

describe("sandbox registry", () => {
  it("removes sandbox directories after normal completion", async () => {
    const { context, sandboxPath, providerTeardown } =
      await createSandboxContext("run-normal", "alpha");
    registeredRuns.add(context.runId);
    registerStagedSandboxContext(context);

    await teardownRegisteredSandboxContext(context);

    expect(providerTeardown).toHaveBeenCalledTimes(1);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);

    await expect(teardownRunSandboxes(context.runId)).resolves.toBeUndefined();
  });

  it("tears down every registered sandbox when flushing a run", async () => {
    const contexts = await Promise.all([
      createSandboxContext("run-pending", "alpha"),
      createSandboxContext("run-pending", "beta"),
    ]);

    for (const { context } of contexts) {
      registeredRuns.add(context.runId);
      registerStagedSandboxContext(context);
    }

    await teardownRunSandboxes("run-pending");

    for (const { sandboxPath, providerTeardown } of contexts) {
      expect(providerTeardown).toHaveBeenCalledTimes(1);
      await expect(pathExists(sandboxPath)).resolves.toBe(false);
    }
  });
});

async function createSandboxContext(
  runId: string,
  agentId: string,
): Promise<{
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
    runId,
  };

  return {
    context,
    sandboxPath,
    providerTeardown,
  };
}
