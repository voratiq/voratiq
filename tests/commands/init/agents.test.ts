import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureAgents } from "../../../src/commands/init/agents.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import type { AgentConfigEntry } from "../../../src/configs/agents/types.js";
import type { ConfirmationOptions } from "../../../src/render/interactions/confirmation.js";
import {
  buildDefaultAgentsTemplate,
  serializeAgentsConfigEntries,
} from "../../../src/workspace/templates.js";

const CLAUDE_DEFAULT_ID = "claude-sonnet-4-5-20250929";
const CODEX_DEFAULT_ID = "gpt-5-1-codex-max";
const GEMINI_DEFAULT_ID = "gemini-2-5-pro";

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

  it("returns existing summary in non-interactive mode without rewriting config", async () => {
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

    const summary = await configureAgents(repoRoot, { interactive: false });

    expect(summary).toEqual({
      configPath: ".voratiq/agents.yaml",
      enabledAgents: ["custom"],
      zeroDetections: false,
      configCreated: false,
      configUpdated: false,
    });

    const updated = await readFile(configPath, "utf8");
    expect(updated).toBe(content);
  });

  it("enables detected agents when confirmed interactively", async () => {
    const binaries: Record<string, string> = {
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
    };

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

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    const defaultContent = buildDefaultAgentsTemplate();
    await writeFile(configPath, defaultContent, "utf8");

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(
      (options) => {
        const summary = (options.prefaceLines ?? []).join("\n");
        if (summary.includes(`\`${CLAUDE_DEFAULT_ID}\``)) {
          return Promise.resolve(true);
        }
        if (summary.includes(`\`${CODEX_DEFAULT_ID}\``)) {
          return Promise.resolve(false);
        }
        if (summary.includes(`\`${GEMINI_DEFAULT_ID}\``)) {
          return Promise.resolve(true);
        }
        throw new Error(`Unexpected confirmation message: ${summary}`);
      },
    );

    const summary = await configureAgents(repoRoot, {
      interactive: true,
      confirm,
    });

    expect(confirm).toHaveBeenCalledTimes(2);
    const firstCall = confirm.mock.calls[0]?.[0];
    expect(firstCall?.prefaceLines?.join("\n")).toContain(
      "Configuring agents…",
    );
    expect(firstCall?.prefaceLines?.join("\n")).toContain(
      `\`${CLAUDE_DEFAULT_ID}\``,
    );
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
    expect(claude?.binary).toBe(binaries.claude);

    expect(codex?.enabled).toBe(false);
    expect(codex?.binary).toBe(binaries.codex);

    expect(gemini?.enabled).toBe(false);
    expect(gemini?.binary).toBe("");

    expect(summary).toEqual({
      configPath: ".voratiq/agents.yaml",
      enabledAgents: [CLAUDE_DEFAULT_ID],
      zeroDetections: false,
      configCreated: false,
      configUpdated: true,
    });
  });

  it("reports zero detections when no agent binaries are found", async () => {
    (spawnSync as jest.MockedFunction<typeof spawnSync>).mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "",
      pid: 0,
      signal: null,
      output: ["", "", ""],
    } as SpawnSyncReturns<string>);

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    const blankContent = serializeAgentsConfigEntries([
      {
        id: "claude",
        provider: "claude",
        model: "claude-sonnet-4-5-20250929",
        enabled: false,
        binary: "",
      },
    ]);
    await writeFile(configPath, blankContent, "utf8");

    const summary = await configureAgents(repoRoot, {
      interactive: true,
      confirm: () => Promise.resolve(true),
    });

    expect(summary.enabledAgents).toEqual([]);
    expect(summary.zeroDetections).toBe(true);
    expect(summary.configCreated).toBe(false);
    expect(summary.configUpdated).toBe(false);
  });
});
