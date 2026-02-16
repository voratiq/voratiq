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

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { RunPreflightError } from "../../../src/commands/run/errors.js";
import { validateAndPrepare } from "../../../src/commands/run/validation.js";
import {
  type AgentCatalogDiagnostics,
  loadAgentCatalogDiagnostics,
} from "../../../src/configs/agents/loader.js";
import { getHeadRevision } from "../../../src/utils/git.js";
jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock("../../../src/configs/agents/loader.js", () => ({
  loadAgentCatalogDiagnostics: jest.fn(),
}));

jest.mock("../../../src/utils/git.js", () => ({
  getHeadRevision: jest.fn(),
}));

const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const loadAgentCatalogDiagnosticsMock = jest.mocked(
  loadAgentCatalogDiagnostics,
);
const getHeadRevisionMock = jest.mocked(getHeadRevision);

describe("run preflight error summary", () => {
  let root: string;
  let specPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "voratiq-preflight-"));
    specPath = join(root, "spec.md");
    await writeFile(specPath, "# Spec\n", "utf8");

    jest.clearAllMocks();
    getHeadRevisionMock.mockResolvedValue("deadbeef");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("throws a single aggregated error with concise per-agent issue lines", async () => {
    const diagnostics: AgentCatalogDiagnostics = {
      enabledAgents: [
        {
          id: "claude-haiku-4-5-20251001",
          provider: "claude",
          model: "model",
          enabled: true,
          binary: "/missing/claude~",
        },
        {
          id: "gpt-5-1-codex",
          provider: "codex",
          model: "model",
          enabled: true,
          binary: "/bin/true",
        },
      ],
      catalog: [],
      issues: [
        {
          agentId: "claude-haiku-4-5-20251001",
          message:
            'binary "/missing/claude~" is not executable (ENOENT) and this message is intentionally very long to force truncation',
        },
      ],
    };
    loadAgentCatalogDiagnosticsMock.mockReturnValue(diagnostics);

    verifyAgentProvidersMock.mockResolvedValue([
      {
        agentId: "gpt-5-1-codex",
        message:
          "invalid_request_error (Unsupported value: 'xhigh' is not supported) and some extra trailing detail to force truncation as well",
      },
    ]);

    let captured: unknown;
    try {
      await validateAndPrepare({ root, specAbsolutePath: specPath });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(RunPreflightError);
    const preflightError = captured as RunPreflightError;
    expect(preflightError.headline).toBe("Preflight failed. Aborting run.");
    expect(preflightError.detailLines).toHaveLength(2);
    expect(preflightError.detailLines[0]?.startsWith("- ")).toBe(true);
    expect(preflightError.detailLines[1]?.startsWith("- ")).toBe(true);
    expect(preflightError.detailLines[0]?.length).toBeLessThanOrEqual(120);
    expect(preflightError.detailLines[1]?.length).toBeLessThanOrEqual(120);
    expect(preflightError.hintLines).toContain(
      "Run `voratiq init` to configure the workspace.",
    );
  });

  it("surfaces invalid settings.yaml as a preflight issue", async () => {
    const diagnostics: AgentCatalogDiagnostics = {
      enabledAgents: [
        {
          id: "gpt-5-1-codex",
          provider: "codex",
          model: "model",
          enabled: true,
          binary: "/bin/true",
        },
      ],
      catalog: [],
      issues: [],
    };
    loadAgentCatalogDiagnosticsMock.mockReturnValue(diagnostics);
    verifyAgentProvidersMock.mockResolvedValue([]);

    await mkdir(join(root, ".voratiq"), { recursive: true });
    await writeFile(
      join(root, ".voratiq", "settings.yaml"),
      "codex:\n  globalConfigPolicy: unignore\n",
      "utf8",
    );

    let captured: unknown;
    try {
      await validateAndPrepare({ root, specAbsolutePath: specPath });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(RunPreflightError);
    const preflightError = captured as RunPreflightError;
    expect(preflightError.detailLines).toHaveLength(1);
    expect(preflightError.detailLines[0]).toContain("Invalid settings file");
  });

  it("does not block selected run agents on diagnostics issues from unselected enabled agents", async () => {
    const diagnostics: AgentCatalogDiagnostics = {
      enabledAgents: [
        {
          id: "selected-agent",
          provider: "codex",
          model: "model",
          enabled: true,
          binary: "/bin/true",
        },
        {
          id: "unselected-broken-agent",
          provider: "claude",
          model: "model",
          enabled: true,
          binary: "/missing/broken",
        },
      ],
      catalog: [
        {
          id: "selected-agent",
          provider: "codex",
          model: "model",
          binary: "/bin/true",
          argv: ["codex", "--model", "model"],
        },
        {
          id: "unselected-broken-agent",
          provider: "claude",
          model: "model",
          binary: "/missing/broken",
          argv: ["claude", "--model", "model"],
        },
      ],
      issues: [
        {
          agentId: "unselected-broken-agent",
          message: 'binary "/missing/broken" is not executable (ENOENT)',
        },
      ],
    };
    loadAgentCatalogDiagnosticsMock.mockReturnValue(diagnostics);
    verifyAgentProvidersMock.mockResolvedValue([]);

    await mkdir(join(root, ".voratiq"), { recursive: true });
    await writeFile(join(root, ".voratiq", "environment.yaml"), "{}\n", "utf8");
    await writeFile(join(root, ".voratiq", "evals.yaml"), "{}\n", "utf8");

    const result = await validateAndPrepare({
      root,
      specAbsolutePath: specPath,
      resolvedAgentIds: ["selected-agent"],
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(["selected-agent"]);
    expect(verifyAgentProvidersMock).toHaveBeenCalledWith([
      {
        id: "selected-agent",
        provider: "codex",
      },
    ]);
  });
});
