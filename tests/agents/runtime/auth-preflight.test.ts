import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { getRunCommand } from "../../../src/agents/runtime/launcher.js";
import { checkPlatformSupport } from "../../../src/agents/runtime/sandbox.js";
import { resolveAuthProvider } from "../../../src/auth/providers/index.js";
import type { AuthProvider } from "../../../src/auth/providers/types.js";
import { buildAuthRuntimeContext } from "../../../src/auth/runtime.js";

jest.mock("../../../src/auth/providers/index.js", () => ({
  resolveAuthProvider: jest.fn(),
}));

jest.mock("../../../src/auth/runtime.js", () => ({
  buildAuthRuntimeContext: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/launcher.js", () => ({
  getRunCommand: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

const resolveAuthProviderMock = jest.mocked(resolveAuthProvider);
const buildAuthRuntimeContextMock = jest.mocked(buildAuthRuntimeContext);
const getRunCommandMock = jest.mocked(getRunCommand);
const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);

describe("verifyAgentProviders (preflight aggregation)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    checkPlatformSupportMock.mockImplementation(() => {});
    getRunCommandMock.mockResolvedValue("srt");
    buildAuthRuntimeContextMock.mockReturnValue({
      platform: "linux",
      env: {},
      homeDir: "/tmp",
      username: "tester",
    });
  });

  it("collects all issues across agents instead of failing fast", async () => {
    const okVerify = jest
      .fn<AuthProvider["verify"]>()
      .mockResolvedValue({ status: "ok" });
    const okStage = jest.fn<AuthProvider["stage"]>();
    const okProvider: AuthProvider = {
      id: "ok",
      verify: okVerify,
      stage: okStage,
    };

    const failingVerify = jest
      .fn<AuthProvider["verify"]>()
      .mockRejectedValue(new Error("PERMISSION_DENIED\nmodel requires Pro"));
    const failingStage = jest.fn<AuthProvider["stage"]>();
    const failingProvider: AuthProvider = {
      id: "bad",
      verify: failingVerify,
      stage: failingStage,
    };

    resolveAuthProviderMock.mockImplementation((id: string) => {
      if (id === "ok") {
        return okProvider;
      }
      if (id === "bad") {
        return failingProvider;
      }
      return undefined;
    });

    const issues = await verifyAgentProviders([
      { id: "alpha", provider: "bad" },
      { id: "beta", provider: "unknown" },
      { id: "gamma", provider: "" },
      { id: "delta", provider: "ok" },
    ]);

    expect(issues).toEqual([
      { agentId: "alpha", message: "PERMISSION_DENIED" },
      { agentId: "alpha", message: "model requires Pro" },
      { agentId: "beta", message: 'unknown auth provider "unknown"' },
      { agentId: "gamma", message: "missing provider" },
    ]);

    expect(failingVerify).toHaveBeenCalledTimes(1);
    expect(okVerify).toHaveBeenCalledTimes(1);
  });
});
