import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import type { StagedAuthContext } from "../../../src/agents/runtime/auth.js";
import {
  registerStagedAuthContext,
  teardownRegisteredAuthContext,
  teardownSessionAuth,
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
    pendingRuns.map((runId) => teardownSessionAuth(runId).catch(() => {})),
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
});

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
