import { describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../src/agents/runtime/auth.js";
import {
  type AgentCatalogDiagnostics,
  loadAgentCatalogDiagnostics,
} from "../../src/configs/agents/loader.js";
import { MissingEnvironmentConfigError } from "../../src/configs/environment/errors.js";
import { loadEnvironmentConfig } from "../../src/configs/environment/loader.js";
import { loadRepoSettings } from "../../src/configs/settings/loader.js";
import {
  prepareConfiguredOperatorReadiness,
  prepareResolvedOperatorReadiness,
} from "../../src/preflight/operator.js";
import { WorkspaceMissingEntryError } from "../../src/workspace/errors.js";

jest.mock("../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock("../../src/configs/agents/loader.js", () => ({
  loadAgentCatalogDiagnostics: jest.fn(),
}));

jest.mock("../../src/configs/environment/loader.js", () => ({
  DEFAULT_ENVIRONMENT_FILE_DISPLAY: "environment.yaml",
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock("../../src/configs/settings/loader.js", () => ({
  loadRepoSettings: jest.fn(),
}));

const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const loadAgentCatalogDiagnosticsMock = jest.mocked(
  loadAgentCatalogDiagnostics,
);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const loadRepoSettingsMock = jest.mocked(loadRepoSettings);

describe("operator preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadRepoSettingsMock.mockReturnValue({
      bounded: { codex: { globalConfigPolicy: "ignore" } },
      mcp: { codex: "ask", claude: "ask", gemini: "ask" },
    });
    loadEnvironmentConfigMock.mockReturnValue({});
    verifyAgentProvidersMock.mockResolvedValue([]);
  });

  it("scopes configured-agent diagnostics and provider checks to selected agents", async () => {
    const diagnostics: AgentCatalogDiagnostics = {
      enabledAgents: [
        {
          id: "selected-agent",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/bin/true",
        },
        {
          id: "unselected-agent",
          provider: "claude",
          model: "claude-sonnet",
          enabled: true,
          binary: "/missing/claude",
        },
      ],
      catalog: [
        {
          id: "selected-agent",
          provider: "codex",
          model: "gpt-5",
          binary: "/bin/true",
          argv: [],
        },
        {
          id: "unselected-agent",
          provider: "claude",
          model: "claude-sonnet",
          binary: "/missing/claude",
          argv: [],
        },
      ],
      issues: [
        {
          agentId: "unselected-agent",
          message: 'binary "/missing/claude" is not executable (ENOENT)',
        },
      ],
    };
    loadAgentCatalogDiagnosticsMock.mockReturnValue(diagnostics);

    const result = await prepareConfiguredOperatorReadiness({
      root: "/repo",
      resolvedAgentIds: ["selected-agent"],
      includeEnvironment: false,
    });

    expect(result.noAgentsEnabled).toBe(false);
    expect(result.agents.map((agent) => agent.id)).toEqual(["selected-agent"]);
    expect(result.issues).toEqual([]);
    expect(verifyAgentProvidersMock).toHaveBeenCalledWith([
      {
        id: "selected-agent",
        provider: "codex",
      },
    ]);
  });

  it("reports no-agents-enabled when selected ids are empty", async () => {
    const result = await prepareConfiguredOperatorReadiness({
      root: "/repo",
      resolvedAgentIds: [],
      includeEnvironment: false,
    });

    expect(result).toEqual({
      agents: [],
      issues: [],
      preProviderIssueCount: 0,
      noAgentsEnabled: true,
    });
    expect(verifyAgentProvidersMock).not.toHaveBeenCalled();
  });

  it("still collects settings issues when no enabled agents are available", async () => {
    loadAgentCatalogDiagnosticsMock.mockReturnValue({
      enabledAgents: [],
      catalog: [],
      issues: [],
    });
    loadRepoSettingsMock.mockImplementation(() => {
      throw new Error("Invalid settings file at /repo/.voratiq/settings.yaml");
    });

    const result = await prepareConfiguredOperatorReadiness({
      root: "/repo",
      includeEnvironment: false,
    });

    expect(result).toEqual({
      agents: [],
      issues: [
        {
          agentId: "settings",
          message: "Invalid settings file at /repo/.voratiq/settings.yaml",
        },
      ],
      preProviderIssueCount: 1,
      noAgentsEnabled: true,
    });
    expect(verifyAgentProvidersMock).not.toHaveBeenCalled();
  });

  it("uses all enabled agents when no explicit selection is provided", async () => {
    loadAgentCatalogDiagnosticsMock.mockReturnValue({
      enabledAgents: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/bin/true",
        },
      ],
      catalog: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "/bin/true",
          argv: [],
        },
      ],
      issues: [],
    });

    const result = await prepareConfiguredOperatorReadiness({
      root: "/repo",
      includeEnvironment: false,
    });

    expect(result.noAgentsEnabled).toBe(false);
    expect(result.agents.map((agent) => agent.id)).toEqual(["alpha"]);
    expect(verifyAgentProvidersMock).toHaveBeenCalledWith([
      {
        id: "alpha",
        provider: "codex",
      },
    ]);
  });

  it("collects settings and provider issues for resolved operators", async () => {
    loadRepoSettingsMock.mockImplementation(() => {
      throw new Error("Invalid settings file at /repo/.voratiq/settings.yaml");
    });
    verifyAgentProvidersMock.mockResolvedValue([
      { agentId: "alpha", message: "missing provider" },
    ]);

    const result = await prepareResolvedOperatorReadiness({
      root: "/repo",
      agents: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "/bin/true",
          argv: [],
        },
      ],
      includeEnvironment: false,
    });

    expect(result.issues).toEqual([
      {
        agentId: "settings",
        message: "Invalid settings file at /repo/.voratiq/settings.yaml",
      },
      {
        agentId: "alpha",
        message: "missing provider",
      },
    ]);
    expect(result.preProviderIssueCount).toBe(1);
  });

  it("maps missing environment to a workspace entry error when requested", async () => {
    loadEnvironmentConfigMock.mockImplementation(() => {
      throw new MissingEnvironmentConfigError(".voratiq/environment.yaml");
    });

    await expect(
      prepareResolvedOperatorReadiness({
        root: "/repo",
        agents: [],
        includeEnvironment: true,
        environmentErrorMode: "workspace-missing",
      }),
    ).rejects.toBeInstanceOf(WorkspaceMissingEntryError);
  });

  it("skips settings validation when includeSettings is false", async () => {
    verifyAgentProvidersMock.mockResolvedValue([
      { agentId: "alpha", message: "missing provider" },
    ]);

    const result = await prepareResolvedOperatorReadiness({
      root: "/repo",
      agents: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "/bin/true",
          argv: [],
        },
      ],
      includeSettings: false,
      includeEnvironment: false,
    });

    expect(result.issues).toEqual([
      {
        agentId: "alpha",
        message: "missing provider",
      },
    ]);
    expect(loadRepoSettingsMock).not.toHaveBeenCalled();
  });

  it("includes loaded environment config when requested", async () => {
    const environment = {
      node: {
        dependencyRoots: ["node_modules"],
      },
    };
    loadEnvironmentConfigMock.mockReturnValue(environment);

    const result = await prepareResolvedOperatorReadiness({
      root: "/repo",
      agents: [],
      includeEnvironment: true,
    });

    expect(result.environment).toEqual(environment);
  });
});
