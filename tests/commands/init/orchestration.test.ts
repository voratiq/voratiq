import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeInitCommand } from "../../../src/commands/init/command.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import { buildDefaultOrchestrationTemplate } from "../../../src/configs/orchestration/bootstrap.js";
import { readOrchestrationConfig } from "../../../src/configs/orchestration/loader.js";

jest.mock("node:child_process", () => {
  const actual =
    jest.requireActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawnSync: jest.fn(),
  };
});

describe("init orchestration bootstrap", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-init-orchestration-"));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    (spawnSync as jest.MockedFunction<typeof spawnSync>).mockReset();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("creates orchestration.yaml when missing", async () => {
    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: false,
    });

    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const agentsConfig = readAgentsConfig(await readFile(agentsPath, "utf8"));
    const expected = buildDefaultOrchestrationTemplate(agentsConfig);

    const content = await readFile(orchestrationPath, "utf8");
    expect(content).toBe(expected);
  });

  it("does not overwrite existing orchestration.yaml", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    await writeFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      "profiles:\n  default:\n    spec:\n      agents: []\n    run:\n      agents: []\n    review:\n      agents: []\n",
      "utf8",
    );

    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: false,
    });

    const content = await readFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      "utf8",
    );
    expect(content).toBe(
      "profiles:\n  default:\n    spec:\n      agents: []\n    run:\n      agents: []\n    review:\n      agents: []\n",
    );
  });

  it("re-seeds from finalized agents after interactive enablement", async () => {
    const spawnSyncMock = spawnSync as jest.MockedFunction<typeof spawnSync>;
    spawnSyncMock.mockImplementation((command, args) => {
      if (command !== "bash" || !Array.isArray(args)) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      const expression = String(args.at(-1));
      const match = /command -v (\w+)/.exec(expression);
      if (!match) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      return {
        status: 0,
        stdout: `/usr/local/bin/${match[1]}\n`,
        stderr: "",
        pid: 0,
        signal: null,
        output: ["", `/usr/local/bin/${match[1]}\n`, ""],
      } as SpawnSyncReturns<string>;
    });

    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");

    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: true,
      confirm: () => Promise.resolve(true),
    });

    expect(spawnSyncMock).toHaveBeenCalled();

    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const agentsConfig = readAgentsConfig(await readFile(agentsPath, "utf8"));
    const enabledIds = agentsConfig.agents
      .filter((agent) => agent.enabled !== false)
      .map((agent) => agent.id);
    expect(enabledIds.length).toBeGreaterThan(0);

    const orchestration = readOrchestrationConfig(
      await readFile(orchestrationPath, "utf8"),
    );
    const runIds = orchestration.profiles.default.run.agents.map(
      (agent) => agent.id,
    );

    expect(runIds).toEqual(enabledIds);
  });
});
