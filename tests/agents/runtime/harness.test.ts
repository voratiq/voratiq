import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import type { StagedAuthContext } from "../../../src/agents/runtime/auth.js";
import { stageAgentAuth } from "../../../src/agents/runtime/auth.js";
import { captureAgentChatArtifacts } from "../../../src/agents/runtime/chat.js";
import { runSandboxedAgent } from "../../../src/agents/runtime/harness.js";
import {
  configureSandboxSettings,
  runAgentProcess,
} from "../../../src/agents/runtime/launcher.js";
import { writeAgentManifest } from "../../../src/agents/runtime/manifest.js";
import {
  registerStagedAuthContext,
  teardownRegisteredAuthContext,
} from "../../../src/agents/runtime/registry.js";
import type { AgentRuntimeHarnessInput } from "../../../src/agents/runtime/types.js";

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  stageAgentAuth: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/chat.js", () => ({
  captureAgentChatArtifacts: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/launcher.js", () => ({
  configureSandboxSettings: jest.fn(),
  runAgentProcess: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/manifest.js", () => ({
  writeAgentManifest: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/registry.js", () => ({
  registerStagedAuthContext: jest.fn(),
  teardownRegisteredAuthContext: jest.fn(),
}));

const stageAgentAuthMock = jest.mocked(stageAgentAuth);
const captureAgentChatArtifactsMock = jest.mocked(captureAgentChatArtifacts);
const configureSandboxSettingsMock = jest.mocked(configureSandboxSettings);
const runAgentProcessMock = jest.mocked(runAgentProcess);
const writeAgentManifestMock = jest.mocked(writeAgentManifest);
const registerStagedAuthContextMock = jest.mocked(registerStagedAuthContext);
const teardownRegisteredAuthContextMock = jest.mocked(
  teardownRegisteredAuthContext,
);

const tempRoots: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();

  const context: StagedAuthContext = {
    provider: {
      id: "test-provider",
      verify: () => Promise.resolve({ status: "ok" }),
      stage: () => Promise.resolve({ sandboxPath: "/tmp/sandbox", env: {} }),
    },
    sandboxPath: "/tmp/sandbox",
    runtime: {
      platform: process.platform,
      env: {},
      homeDir: "/tmp",
      username: "tester",
    },
    agentId: "agent-1",
  };

  stageAgentAuthMock.mockResolvedValue({
    env: { PATH: "/bin" },
    context,
  });
  writeAgentManifestMock.mockResolvedValue({ PATH: "/bin" });
  configureSandboxSettingsMock.mockResolvedValue({
    sandboxSettings: {
      network: {
        allowedDomains: [],
        deniedDomains: [],
      },
      filesystem: {
        denyRead: [],
        allowWrite: [],
        denyWrite: [],
      },
    },
  });
  runAgentProcessMock.mockResolvedValue({
    exitCode: 0,
    signal: null,
  });
  captureAgentChatArtifactsMock.mockResolvedValue({
    captured: false,
  });
  teardownRegisteredAuthContextMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runSandboxedAgent auth teardown", () => {
  it("tears down auth context by default", async () => {
    const input = await createHarnessInput();

    await runSandboxedAgent(input);

    expect(registerStagedAuthContextMock).toHaveBeenCalledTimes(1);
    expect(teardownRegisteredAuthContextMock).toHaveBeenCalledTimes(1);
    expect(teardownRegisteredAuthContextMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ agentId: "agent-1" }),
    );
  });

  it("defers auth teardown when teardownAuthOnExit is false", async () => {
    const input = await createHarnessInput();

    await runSandboxedAgent({
      ...input,
      teardownAuthOnExit: false,
    });

    expect(registerStagedAuthContextMock).toHaveBeenCalledTimes(1);
    expect(teardownRegisteredAuthContextMock).not.toHaveBeenCalled();
  });
});

async function createHarnessInput(): Promise<AgentRuntimeHarnessInput> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-harness-"));
  tempRoots.push(root);

  return {
    root,
    sessionId: "run-1",
    agent: {
      id: "agent-1",
      provider: "test-provider",
      model: "test-model",
      binary: "/bin/echo",
      argv: ["hello"],
    },
    prompt: "test prompt",
    environment: {},
    captureChat: false,
    paths: {
      agentRoot: join(root, "agent"),
      workspacePath: join(root, "workspace"),
      sandboxHomePath: join(root, "sandbox-home"),
      runtimeManifestPath: join(root, "runtime", "manifest.json"),
      sandboxSettingsPath: join(root, "runtime", "sandbox.json"),
      runtimePath: join(root, "runtime"),
      artifactsPath: join(root, "artifacts"),
      stdoutPath: join(root, "artifacts", "stdout.log"),
      stderrPath: join(root, "artifacts", "stderr.log"),
    },
  };
}
