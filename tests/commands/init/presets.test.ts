import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeInitCommand } from "../../../src/commands/init/command.js";
import {
  getAgentDefaultId,
  getAgentDefaultsForPreset,
  getSupportedAgentDefaults,
} from "../../../src/configs/agents/defaults.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import type { AgentConfigEntry } from "../../../src/configs/agents/types.js";
import type { PromptOptions } from "../../../src/render/interactions/confirmation.js";
import {
  buildAgentsTemplate,
  serializeAgentsConfigEntries,
} from "../../../src/workspace/templates.js";

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

describe("voratiq init preset application", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-init-presets-"));
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

  it("writes lite preset when agents config is missing", async () => {
    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      interactive: false,
    });

    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const content = await readFile(agentsPath, "utf8");
    expect(content).toBe(buildAgentsTemplate("lite"));
  });

  it.each(["pro", "lite", "manual"] as const)(
    "fresh init seeds full catalog with implicit enabled defaults for %s",
    async (preset) => {
      await executeInitCommand({
        root: repoRoot,
        preset,
        interactive: false,
      });

      const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
      const content = await readFile(agentsPath, "utf8");
      const parsed = readAgentsConfig(content);
      const expectedIds = getSupportedAgentDefaults().map((entry) =>
        getAgentDefaultId(entry),
      );

      expect(parsed.agents.map((entry) => entry.id)).toEqual(expectedIds);
      expect(content).not.toContain("enabled: true");
    },
  );

  it("switches from pro template to lite when safe", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(agentsPath, buildAgentsTemplate("pro"), "utf8");

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: false,
    });

    const content = await readFile(agentsPath, "utf8");
    expect(content).toBe(buildAgentsTemplate("lite"));
  });

  it("does not overwrite customized agent configs when applying presets", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const entries: AgentConfigEntry[] = [
      {
        id: "custom",
        provider: "codex",
        model: "custom-model",
        enabled: true,
        binary: "/usr/local/bin/custom",
      },
    ];
    const content = serializeAgentsConfigEntries(entries);
    await writeFile(agentsPath, content, "utf8");

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: false,
    });

    const updated = await readFile(agentsPath, "utf8");
    expect(updated).toBe(content);
  });

  it("prompts for preset selection when interactive and config is missing", async () => {
    const prompt = createPromptMock("2");

    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: true,
      prompt,
    });

    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const content = await readFile(agentsPath, "utf8");
    expect(content).toBe(buildAgentsTemplate("lite"));
    expect(prompt).toHaveBeenCalled();

    const firstPromptCall = prompt.mock.calls[0]?.[0];
    expect(firstPromptCall?.message).toBe("[1]");

    const prefaceLines = firstPromptCall?.prefaceLines ?? [];
    expect(prefaceLines).toContain("Which workspace preset would you like?");
    expect(prefaceLines).toContain("  [1] Pro (flagship)");
    expect(prefaceLines).toContain("  [2] Lite (faster/cheaper)");
    expect(prefaceLines).toContain("  [3] Manual (configure yourself)");
  });

  it("does not prompt for preset selection when agents config exists", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(agentsPath, buildAgentsTemplate("lite"), "utf8");

    const prompt = createPromptMock("1");

    await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: true,
      prompt,
    });

    const content = await readFile(agentsPath, "utf8");
    expect(content).toBe(buildAgentsTemplate("lite"));
    expect(prompt).not.toHaveBeenCalled();
  });

  it("switches managed pro to lite without forcing enablement changes", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");

    const proConfig = readAgentsConfig(buildAgentsTemplate("pro"));
    const managedEntries: AgentConfigEntry[] = proConfig.agents.map(
      (entry) => ({
        ...entry,
        enabled: true,
        binary: `/usr/local/bin/${entry.provider}`,
      }),
    );
    const userAgent: AgentConfigEntry = {
      id: "custom",
      provider: "codex",
      model: "custom-model",
      enabled: false,
      binary: "/usr/local/bin/custom",
      extraArgs: ["--foo", "bar"],
    };

    const managedPro = serializeAgentsConfigEntries([
      ...managedEntries,
      userAgent,
    ]);
    await writeFile(agentsPath, managedPro, "utf8");

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: false,
    });

    const updated = readAgentsConfig(await readFile(agentsPath, "utf8"));
    const expectedManagedById = new Map(
      managedEntries.map((entry) => [entry.id, entry]),
    );

    const managed = updated.agents.filter((entry) => entry.id !== userAgent.id);
    expect(managed).toHaveLength(managedEntries.length);
    for (const entry of managed) {
      const prior = expectedManagedById.get(entry.id);
      expect(prior).toBeDefined();
      expect(entry.binary).toBe(`/usr/local/bin/${entry.provider}`);
      expect(entry.enabled).toBe(prior?.enabled !== false);
    }
    expect(updated.agents.find((entry) => entry.id === userAgent.id)).toEqual(
      userAgent,
    );
  });

  it("preserves provider-disabled intent when migrating old managed preset files", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");

    const legacyManagedProEntries: AgentConfigEntry[] =
      getAgentDefaultsForPreset("pro").map((agentDefault) => ({
        id: getAgentDefaultId(agentDefault),
        provider: agentDefault.provider,
        model: agentDefault.model,
        enabled: agentDefault.provider === "codex" ? false : true,
        binary: `/usr/local/bin/${agentDefault.provider}`,
        extraArgs:
          agentDefault.extraArgs && agentDefault.extraArgs.length > 0
            ? [...agentDefault.extraArgs]
            : undefined,
      }));

    await writeFile(
      agentsPath,
      serializeAgentsConfigEntries(legacyManagedProEntries),
      "utf8",
    );

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: false,
    });

    const updated = readAgentsConfig(await readFile(agentsPath, "utf8"));
    const priorIds = new Set(legacyManagedProEntries.map((entry) => entry.id));
    const codexEntries = updated.agents.filter(
      (entry) => entry.provider === "codex",
    );
    const migratedCodexVariants = codexEntries.filter(
      (entry) => !priorIds.has(entry.id),
    );

    expect(codexEntries.length).toBeGreaterThan(0);
    expect(migratedCodexVariants.length).toBeGreaterThan(0);
    for (const entry of codexEntries) {
      expect(entry.enabled).toBe(false);
    }
  });

  it("does not overwrite when a managed agent's provider/model is customized", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");

    const proConfig = readAgentsConfig(buildAgentsTemplate("pro"));
    const customized: AgentConfigEntry[] = proConfig.agents.map((entry) => {
      if (entry.provider === "codex") {
        return { ...entry, model: "gpt-custom" };
      }
      return entry;
    });
    const content = serializeAgentsConfigEntries(customized);
    await writeFile(agentsPath, content, "utf8");

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: false,
    });

    const updated = await readFile(agentsPath, "utf8");
    expect(updated).toBe(content);
  });

  it("skips preset selection when preset is provided", async () => {
    const prompt = createPromptMock("2");

    await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      presetProvided: true,
      interactive: true,
      prompt,
    });

    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    const content = await readFile(agentsPath, "utf8");
    expect(content).toBe(buildAgentsTemplate("lite"));
    expect(prompt).not.toHaveBeenCalled();
  });
});

function createPromptMock(
  response: string,
): jest.Mock<Promise<string>, [PromptOptions]> {
  return jest.fn<Promise<string>, [PromptOptions]>(() =>
    Promise.resolve(response),
  );
}
