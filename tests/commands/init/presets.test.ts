import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeInitCommand } from "../../../src/commands/init/command.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import type { AgentConfigEntry } from "../../../src/configs/agents/types.js";
import {
  buildAgentsTemplate,
  serializeAgentsConfigEntries,
} from "../../../src/workspace/templates.js";

describe("voratiq init preset application", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-init-presets-"));
  });

  afterEach(async () => {
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
    const prompt = jest.fn().mockResolvedValue("2");

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
  });

  it("does not prompt for preset selection when agents config exists", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(agentsPath, buildAgentsTemplate("lite"), "utf8");

    const prompt = jest.fn().mockResolvedValue("1");

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

  it("switches managed pro to lite when only binary/enabled differ", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    const agentsPath = join(repoRoot, ".voratiq", "agents.yaml");

    const proConfig = readAgentsConfig(buildAgentsTemplate("pro"));
    const managedEntries: AgentConfigEntry[] = proConfig.agents.map(
      (entry) => ({
        ...entry,
        enabled: entry.provider !== "gemini",
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

    const liteConfig = readAgentsConfig(buildAgentsTemplate("lite"));
    const expectedManagedLite: AgentConfigEntry[] = liteConfig.agents.map(
      (entry) => {
        const prior = managedEntries.find(
          (priorEntry) => priorEntry.provider === entry.provider,
        );
        return {
          ...entry,
          enabled: prior ? prior.enabled !== false : false,
          binary: prior?.binary ?? "",
        };
      },
    );
    const expected = serializeAgentsConfigEntries([
      ...expectedManagedLite,
      userAgent,
    ]);

    const updated = await readFile(agentsPath, "utf8");
    expect(updated).toBe(expected);
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
    const prompt = jest.fn().mockResolvedValue("2");

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
