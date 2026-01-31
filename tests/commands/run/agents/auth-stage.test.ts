import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { stageAgentAuth } from "../../../../src/agents/runtime/auth.js";
import { resolveAuthProvider } from "../../../../src/auth/providers/index.js";
import type {
  AuthProvider,
  AuthRuntimeContext,
} from "../../../../src/auth/providers/types.js";
import { buildAuthRuntimeContext } from "../../../../src/auth/runtime.js";
import type { AgentDefinition } from "../../../../src/configs/agents/types.js";
import { loadRepoSettings } from "../../../../src/configs/settings/loader.js";

jest.mock("../../../../src/auth/providers/index.js", () => ({
  resolveAuthProvider: jest.fn(),
}));

jest.mock("../../../../src/auth/runtime.js", () => ({
  buildAuthRuntimeContext: jest.fn(),
}));

jest.mock("../../../../src/configs/settings/loader.js", () => ({
  loadRepoSettings: jest.fn(),
}));

const resolveAuthProviderMock = jest.mocked(resolveAuthProvider);
const buildAuthRuntimeContextMock = jest.mocked(buildAuthRuntimeContext);
const loadRepoSettingsMock = jest.mocked(loadRepoSettings);

describe("stageAgentAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadRepoSettingsMock.mockReturnValue({
      codex: { globalConfigPolicy: "apply" },
    });
  });

  it("stages credentials and returns the staged context", async () => {
    const agent: AgentDefinition = {
      id: "alpha",
      provider: "claude",
      binary: "node",
      argv: ["start"],
      model: "claude-3",
    };

    const runtime: AuthRuntimeContext = {
      platform: "darwin",
      env: {},
      homeDir: "/tmp",
      username: "tester",
    };
    buildAuthRuntimeContextMock.mockReturnValue(runtime);

    type ProviderStage = AuthProvider["stage"];
    const stageMock = jest.fn<ProviderStage>().mockResolvedValue({
      env: { CLAUDE_SESSION: "session-token" },
      sandboxPath: "/tmp/sbx",
    });
    const provider: AuthProvider = {
      id: "claude",
      verify: jest.fn<AuthProvider["verify"]>().mockResolvedValue({
        status: "ok",
      }),
      stage: stageMock,
    };
    resolveAuthProviderMock.mockReturnValue(provider);

    const result = await stageAgentAuth({
      agent,
      agentRoot: "/tmp/workspace",
      runId: "run-123",
      root: "/tmp",
    });

    expect(stageMock).toHaveBeenCalledWith({
      agentId: "alpha",
      agentRoot: "/tmp/workspace",
      includeConfigToml: true,
      runtime,
      runId: "run-123",
      root: "/tmp",
    });
    expect(result.env).toEqual({ CLAUDE_SESSION: "session-token" });
    expect(result.context.provider).toBe(provider);
    expect(result.context.sandboxPath).toBe("/tmp/sbx");
    expect(result.context.agentId).toBe("alpha");
  });
});
