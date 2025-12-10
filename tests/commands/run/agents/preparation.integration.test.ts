import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

import type {
  AuthProvider,
  AuthRuntimeContext,
} from "../../../../src/auth/providers/types.js";
import type { StagedAuthContext } from "../../../../src/commands/run/agents/auth-stage.js";
import { stageAgentAuth } from "../../../../src/commands/run/agents/auth-stage.js";
import { prepareAgentForExecution } from "../../../../src/commands/run/agents/preparation.js";
import { writeAgentManifest } from "../../../../src/commands/run/agents/workspace-prep.js";
import { teardownRunSandboxes } from "../../../../src/commands/run/sandbox-registry.js";
import type { AgentDefinition } from "../../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../../src/configs/environment/types.js";
import { pathExists } from "../../../../src/utils/fs.js";
import { buildAgentWorkspacePaths } from "../../../../src/workspace/layout.js";

jest.mock("../../../../src/workspace/agents.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../../src/workspace/agents.js")
  >("../../../../src/workspace/agents.js");
  const prepareAgentWorkspaceMock = jest
    .fn<typeof actual.prepareAgentWorkspace>()
    .mockResolvedValue(undefined);
  return {
    ...actual,
    prepareAgentWorkspace: prepareAgentWorkspaceMock,
  };
});

jest.mock("../../../../src/commands/run/agents/chat-preserver.js", () => ({
  captureAgentChatTranscripts: jest
    .fn<
      (typeof import("../../../../src/commands/run/agents/chat-preserver.js"))["captureAgentChatTranscripts"]
    >()
    .mockResolvedValue(undefined),
}));

jest.mock("../../../../src/commands/run/agents/workspace-prep.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../../src/commands/run/agents/workspace-prep.js")
  >("../../../../src/commands/run/agents/workspace-prep.js");
  const writeAgentManifestMock = jest.fn<typeof actual.writeAgentManifest>();
  return {
    ...actual,
    writeAgentManifest: writeAgentManifestMock,
  };
});

jest.mock("../../../../src/commands/run/agents/auth-stage.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../../src/commands/run/agents/auth-stage.js")
  >("../../../../src/commands/run/agents/auth-stage.js");
  const stageAgentAuthMock = jest.fn<typeof actual.stageAgentAuth>();
  return {
    ...actual,
    stageAgentAuth: stageAgentAuthMock,
  };
});

const stageAgentAuthMock = jest.mocked(stageAgentAuth);
const writeAgentManifestMock = jest.mocked(writeAgentManifest);

describe("prepareAgentForExecution", () => {
  const environment: EnvironmentConfig = {};
  const agent: AgentDefinition = {
    id: "agent-prep",
    provider: "test-provider",
    model: "mock",
    binary: "node",
    argv: ["run"],
  };
  const runId = "run-prep";
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "voratiq-prep-"));
    stageAgentAuthMock.mockReset();
    writeAgentManifestMock.mockReset();
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    await teardownRunSandboxes(runId).catch(() => {});
  });

  it("tears down sandbox directories when manifest writing fails", async () => {
    const workspacePaths = buildAgentWorkspacePaths({
      root: tempRoot,
      runId,
      agentId: agent.id,
    });

    await mkdir(workspacePaths.agentRoot, { recursive: true });
    await mkdir(workspacePaths.sandboxPath, { recursive: true });
    await writeFile(
      join(workspacePaths.sandboxPath, "secret"),
      "token",
      "utf8",
    );

    const runtime: AuthRuntimeContext = {
      platform: process.platform,
      env: {},
      homeDir: tempRoot,
      username: "tester",
    };

    const provider: AuthProvider = {
      id: "test-provider",
      verify: () => Promise.resolve({ status: "ok" }),
      stage: () =>
        Promise.resolve({
          sandboxPath: workspacePaths.sandboxPath,
          env: {},
        }),
    };

    const stagedContext: StagedAuthContext = {
      provider,
      sandboxPath: workspacePaths.sandboxPath,
      runtime,
      agentId: agent.id,
      runId,
    };

    stageAgentAuthMock.mockResolvedValue({
      env: {},
      context: stagedContext,
    });
    writeAgentManifestMock.mockRejectedValue(new Error("manifest failure"));

    const result = await prepareAgentForExecution({
      agent,
      baseRevisionSha: "abc123",
      runId,
      root: tempRoot,
      evalPlan: [],
      environment,
    });

    expect(result.status).toBe("failed");
    await expect(pathExists(workspacePaths.sandboxPath)).resolves.toBe(false);
  });
});
