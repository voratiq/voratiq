import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureAgents } from "../../../src/commands/init/agents.js";
import {
  getAgentDefaultsForPreset,
  getDefaultAgentIdByProvider,
  sanitizeAgentIdFromModel,
} from "../../../src/configs/agents/defaults.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import type { AgentConfigEntry } from "../../../src/configs/agents/types.js";
import type { ConfirmationOptions } from "../../../src/render/interactions/confirmation.js";
import {
  buildAgentsTemplate,
  serializeAgentsConfigEntries,
} from "../../../src/workspace/templates.js";

const CLAUDE_DEFAULT_ID = getDefaultAgentIdByProvider("claude") ?? "claude";
const CODEX_DEFAULT_ID = getDefaultAgentIdByProvider("codex") ?? "codex";
const GEMINI_DEFAULT_ID = getDefaultAgentIdByProvider("gemini") ?? "gemini";

jest.mock("node:child_process", () => ({
  spawnSync: jest.fn(),
}));

describe("configureAgents", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-agents-"));
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const spawnSyncMock = spawnSync as jest.MockedFunction<typeof spawnSync>;
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "",
      pid: 0,
      signal: null,
      output: ["", "", ""],
    } as SpawnSyncReturns<string>);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    (spawnSync as jest.MockedFunction<typeof spawnSync>).mockReset();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("returns existing summary in non-interactive mode without rewriting custom config", async () => {
    const entries: AgentConfigEntry[] = [
      {
        id: "custom",
        provider: "claude",
        model: "custom-model",
        enabled: true,
        binary: "/usr/local/bin/custom",
      },
    ];
    const content = serializeAgentsConfigEntries(entries);
    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, content, "utf8");

    const summary = await configureAgents(repoRoot, "pro", {
      interactive: false,
    });

    expect(summary).toEqual({
      configPath: ".voratiq/agents.yaml",
      enabledAgents: ["custom"],
      agentCount: 1,
      zeroDetections: true,
      detectedProviders: [],
      providerEnablementPrompted: false,
      configCreated: false,
      configUpdated: false,
    });

    const updated = await readFile(configPath, "utf8");
    expect(updated).toBe(content);
  });

  it("skips prompting when config is customized (not a preset template)", async () => {
    const entries: AgentConfigEntry[] = [
      {
        id: "custom",
        provider: "claude",
        model: "custom-model",
        enabled: true,
        binary: "/usr/local/bin/custom",
      },
    ];
    const content = serializeAgentsConfigEntries(entries);
    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, content, "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(true),
    );

    const summary = await configureAgents(repoRoot, "pro", {
      interactive: true,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(summary.enabledAgents).toEqual(["custom"]);
    expect(summary.providerEnablementPrompted).toBe(false);

    const updated = await readFile(configPath, "utf8");
    expect(updated).toBe(content);
  });

  it("enables detected providers without prompting", async () => {
    mockDetectedBinaries({
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
    });

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, buildAgentsTemplate("pro"), "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(true),
    );

    const summary = await configureAgents(repoRoot, "pro", {
      interactive: true,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();

    const updated = await readFile(configPath, "utf8");
    const parsed = readAgentsConfig(updated);

    const claude = parsed.agents.find(
      (entry) => entry.id === CLAUDE_DEFAULT_ID,
    );
    const codex = parsed.agents.find((entry) => entry.id === CODEX_DEFAULT_ID);
    const gemini = parsed.agents.find(
      (entry) => entry.id === GEMINI_DEFAULT_ID,
    );

    expect(claude?.enabled).toBe(true);
    expect(claude?.binary).toBe("/usr/bin/claude");
    expect(codex?.enabled).toBe(true);
    expect(codex?.binary).toBe("/usr/bin/codex");
    expect(gemini?.enabled).toBe(false);
    expect(gemini?.binary).toBe("");

    expect(summary).toEqual({
      configPath: ".voratiq/agents.yaml",
      enabledAgents: [CLAUDE_DEFAULT_ID, CODEX_DEFAULT_ID],
      agentCount: 3,
      zeroDetections: false,
      detectedProviders: [
        { provider: "claude", binary: "/usr/bin/claude" },
        { provider: "codex", binary: "/usr/bin/codex" },
      ],
      providerEnablementPrompted: false,
      configCreated: false,
      configUpdated: true,
    });
  });

  it("includes lite preset agent ids when providers are detected", async () => {
    mockDetectedBinaries({
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
      gemini: "/usr/bin/gemini",
    });

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, buildAgentsTemplate("lite"), "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(true),
    );

    const summary = await configureAgents(repoRoot, "lite", {
      interactive: true,
      confirm,
    });

    const expectedLiteIds = getAgentDefaultsForPreset("lite").map((entry) =>
      sanitizeAgentIdFromModel(entry.model),
    );
    expect(summary.enabledAgents).toEqual(expectedLiteIds);
    expect(summary.agentCount).toBe(expectedLiteIds.length);
    expect(summary.zeroDetections).toBe(false);
    expect(summary.providerEnablementPrompted).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("auto-accepts detected providers without prompting when assumeYes is set", async () => {
    mockDetectedBinaries({
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
    });

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, buildAgentsTemplate("pro"), "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(false),
    );

    const summary = await configureAgents(repoRoot, "pro", {
      interactive: true,
      assumeYes: true,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(summary.providerEnablementPrompted).toBe(false);
    expect(summary.enabledAgents).toEqual([
      CLAUDE_DEFAULT_ID,
      CODEX_DEFAULT_ID,
    ]);
  });

  it("reports zero detections and skips provider prompt when no CLIs are found", async () => {
    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, buildAgentsTemplate("pro"), "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(true),
    );

    const summary = await configureAgents(repoRoot, "pro", {
      interactive: true,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(summary.enabledAgents).toEqual([]);
    expect(summary.zeroDetections).toBe(true);
    expect(summary.detectedProviders).toEqual([]);
    expect(summary.providerEnablementPrompted).toBe(false);
    expect(summary.configCreated).toBe(false);
    expect(summary.configUpdated).toBe(false);
  });

  it("skips prompting when preset is manual", async () => {
    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, serializeAgentsConfigEntries([]), "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(true),
    );

    const summary = await configureAgents(repoRoot, "manual", {
      interactive: true,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(summary).toEqual({
      configPath: ".voratiq/agents.yaml",
      enabledAgents: [],
      agentCount: 0,
      zeroDetections: true,
      detectedProviders: [],
      providerEnablementPrompted: false,
      configCreated: false,
      configUpdated: false,
    });
  });

  it("reports supported provider detections for manual preset", async () => {
    mockDetectedBinaries({
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
    });

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, serializeAgentsConfigEntries([]), "utf8");

    const summary = await configureAgents(repoRoot, "manual", {
      interactive: false,
    });

    expect(summary.enabledAgents).toEqual([]);
    expect(summary.zeroDetections).toBe(false);
    expect(summary.detectedProviders).toEqual([
      { provider: "claude", binary: "/usr/bin/claude" },
      { provider: "codex", binary: "/usr/bin/codex" },
    ]);
    expect(summary.providerEnablementPrompted).toBe(false);
  });
});

function mockDetectedBinaries(binaries: Record<string, string>): void {
  (spawnSync as jest.MockedFunction<typeof spawnSync>).mockImplementation(
    (command, args) => {
      if (command !== "bash" || !Array.isArray(args)) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      const lookup = String(args.at(-1));
      const match = /command -v (\w+)/.exec(lookup);
      if (!match) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      const binaryPath = binaries[match[1]];
      if (!binaryPath) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      return {
        status: 0,
        stdout: `${binaryPath}\n`,
        stderr: "",
        pid: 0,
        signal: null,
        output: ["", `${binaryPath}\n`, ""],
      } as SpawnSyncReturns<string>;
    },
  );
}
