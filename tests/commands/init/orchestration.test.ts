import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeInitCommand } from "../../../src/commands/init/command.js";
import {
  getAgentDefaultId,
  getAgentDefaultsForPreset,
} from "../../../src/configs/agents/defaults.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import { buildDefaultOrchestrationTemplate } from "../../../src/configs/orchestration/bootstrap.js";
import { readOrchestrationConfig } from "../../../src/configs/orchestration/loader.js";
import { buildAgentsTemplate } from "../../../src/workspace/templates.js";

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

  it("creates orchestration.yaml from preset defaults when missing", async () => {
    mockDetectedBinaries({
      claude: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
      gemini: "/usr/local/bin/gemini",
    });

    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: false,
    });

    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const agentsConfig = readAgentsConfig(await readFile(agentsPath, "utf8"));
    const expected = buildDefaultOrchestrationTemplate(agentsConfig, "pro");

    const content = await readFile(orchestrationPath, "utf8");
    expect(content).toBe(expected);

    const orchestration = readOrchestrationConfig(content);
    const expectedProIds = getAgentDefaultsForPreset("pro").map((agent) =>
      getAgentDefaultId(agent),
    );
    expect(orchestration.profiles.default.spec.agents).toEqual([]);
    expect(
      orchestration.profiles.default.run.agents.map((agent) => agent.id),
    ).toEqual(expectedProIds);
    expect(orchestration.profiles.default.review.agents).toEqual([]);
  });

  it("seeds lite run from detected enabled providers only", async () => {
    mockDetectedBinaries({
      codex: "/usr/local/bin/codex",
      gemini: "/usr/local/bin/gemini",
    });

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      interactive: false,
    });

    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const orchestration = readOrchestrationConfig(
      await readFile(orchestrationPath, "utf8"),
    );

    const expectedLiteIds = getAgentDefaultsForPreset("lite")
      .filter(
        (agent) => agent.provider === "codex" || agent.provider === "gemini",
      )
      .map((agent) => getAgentDefaultId(agent));
    const runIds = orchestration.profiles.default.run.agents.map(
      (agent) => agent.id,
    );
    const reviewIds = orchestration.profiles.default.review.agents.map(
      (agent) => agent.id,
    );
    const specIds = orchestration.profiles.default.spec.agents.map(
      (agent) => agent.id,
    );

    expect(runIds).toEqual(expectedLiteIds);
    expect(reviewIds).toEqual([]);
    expect(specIds).toEqual([]);
  });

  it("recreates missing orchestration.yaml with run-only seeding from updated preset", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    await writeFile(
      join(repoRoot, ".voratiq", "agents.yaml"),
      buildAgentsTemplate("lite"),
      "utf8",
    );

    mockDetectedBinaries({
      codex: "/usr/local/bin/codex",
      gemini: "/usr/local/bin/gemini",
    });

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: false,
    });

    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const orchestration = readOrchestrationConfig(
      await readFile(orchestrationPath, "utf8"),
    );

    const expectedLiteIds = getAgentDefaultsForPreset("lite")
      .filter(
        (agent) => agent.provider === "codex" || agent.provider === "gemini",
      )
      .map((agent) => getAgentDefaultId(agent));

    expect(orchestration.profiles.default.spec.agents).toEqual([]);
    expect(
      orchestration.profiles.default.run.agents.map((agent) => agent.id),
    ).toEqual(expectedLiteIds);
    expect(orchestration.profiles.default.review.agents).toEqual([]);
  });

  it("seeds empty stage agent lists for manual preset", async () => {
    mockDetectedBinaries({
      claude: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
      gemini: "/usr/local/bin/gemini",
    });

    await executeInitCommand({
      root: repoRoot,
      preset: "manual",
      interactive: false,
    });

    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const orchestration = readOrchestrationConfig(
      await readFile(orchestrationPath, "utf8"),
    );

    expect(orchestration.profiles.default.spec.agents).toEqual([]);
    expect(orchestration.profiles.default.run.agents).toEqual([]);
    expect(orchestration.profiles.default.review.agents).toEqual([]);
  });

  it("seeds defaults in interactive mode without provider confirmation", async () => {
    mockDetectedBinaries({
      claude: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
      gemini: "/usr/local/bin/gemini",
    });

    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: true,
    });

    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const orchestration = readOrchestrationConfig(
      await readFile(orchestrationPath, "utf8"),
    );
    const expectedProIds = getAgentDefaultsForPreset("pro").map((agent) =>
      getAgentDefaultId(agent),
    );

    expect(orchestration.profiles.default.spec.agents).toEqual([]);
    expect(
      orchestration.profiles.default.run.agents.map((agent) => agent.id),
    ).toEqual(expectedProIds);
    expect(orchestration.profiles.default.review.agents).toEqual([]);
  });

  it("does not overwrite existing orchestration.yaml", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    await writeFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents: []",
        "    review:",
        "      agents: []",
        "",
      ].join("\n"),
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
      [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents: []",
        "    review:",
        "      agents: []",
        "",
      ].join("\n"),
    );
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

      const expression = String(args.at(-1));
      const match = /command -v (\w+)/.exec(expression);
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
