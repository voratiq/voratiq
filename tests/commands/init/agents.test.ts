import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureAgents } from "../../../src/commands/init/agents.js";
import {
  getAgentDefaultId,
  getDefaultAgentIdByProvider,
  getSupportedAgentDefaults,
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
const FULL_CATALOG_IDS = getSupportedAgentDefaults().map((entry) =>
  getAgentDefaultId(entry),
);
const ENABLED_IDS_BY_PROVIDER = new Map<string, string[]>(
  ["claude", "codex", "gemini"].map((provider) => [
    provider,
    getSupportedAgentDefaults()
      .filter((entry) => entry.provider === provider)
      .map((entry) => getAgentDefaultId(entry)),
  ]),
);

function enabledIdsForProviders(...providers: string[]): string[] {
  return providers.flatMap(
    (provider) => ENABLED_IDS_BY_PROVIDER.get(provider) ?? [],
  );
}
describe("configureAgents", () => {
  let repoRoot: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-agents-"));
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    originalPath = process.env.PATH;
    process.env.PATH = "";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
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
    const detectedBinaries = await mockDetectedBinaries(repoRoot, {
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
    expect(claude?.binary).toBe(detectedBinaries.claude);
    expect(codex?.enabled).toBe(true);
    expect(codex?.binary).toBe(detectedBinaries.codex);
    expect(gemini?.enabled).toBe(false);
    expect(gemini?.binary).toBe("");
    for (const entry of parsed.agents) {
      const expectedBinary =
        entry.provider === "claude" || entry.provider === "codex"
          ? detectedBinaries[entry.provider]
          : "";
      expect(entry.binary).toBe(expectedBinary);
      expect(entry.enabled).toBe(
        entry.provider === "claude" || entry.provider === "codex",
      );
    }

    expect(summary).toEqual({
      configPath: ".voratiq/agents.yaml",
      enabledAgents: enabledIdsForProviders("claude", "codex"),
      agentCount: FULL_CATALOG_IDS.length,
      zeroDetections: false,
      detectedProviders: [
        { provider: "claude", binary: detectedBinaries.claude },
        { provider: "codex", binary: detectedBinaries.codex },
      ],
      providerEnablementPrompted: false,
      configCreated: false,
      configUpdated: true,
    });
  });

  it("keeps the full catalog enabled for lite preset when providers are detected", async () => {
    const detectedBinaries = await mockDetectedBinaries(repoRoot, {
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

    expect(summary.enabledAgents).toEqual(FULL_CATALOG_IDS);
    expect(summary.agentCount).toBe(FULL_CATALOG_IDS.length);
    expect(summary.zeroDetections).toBe(false);
    expect(summary.providerEnablementPrompted).toBe(false);
    expect(confirm).not.toHaveBeenCalled();

    const updated = readAgentsConfig(await readFile(configPath, "utf8"));
    for (const entry of updated.agents) {
      expect(entry.binary).toBe(detectedBinaries[entry.provider]);
      expect(entry.enabled).toBe(true);
    }
  });

  it("auto-accepts detected providers without prompting when assumeYes is set", async () => {
    await mockDetectedBinaries(repoRoot, {
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
    expect(summary.enabledAgents).toEqual(
      enabledIdsForProviders("claude", "codex"),
    );
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
    expect(summary.agentCount).toBe(FULL_CATALOG_IDS.length);
    expect(summary.zeroDetections).toBe(true);
    expect(summary.detectedProviders).toEqual([]);
    expect(summary.providerEnablementPrompted).toBe(false);
    expect(summary.configCreated).toBe(false);
    expect(summary.configUpdated).toBe(true);
  });

  it("skips prompting when preset is manual", async () => {
    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, buildAgentsTemplate("manual"), "utf8");

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
      agentCount: FULL_CATALOG_IDS.length,
      zeroDetections: true,
      detectedProviders: [],
      providerEnablementPrompted: false,
      configCreated: false,
      configUpdated: true,
    });

    const updated = readAgentsConfig(await readFile(configPath, "utf8"));
    expect(updated.agents).toHaveLength(FULL_CATALOG_IDS.length);
    expect(updated.agents.every((entry) => entry.enabled === false)).toBe(true);
  });

  it("reports supported provider detections for manual preset", async () => {
    const detectedBinaries = await mockDetectedBinaries(repoRoot, {
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
    });

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    await writeFile(configPath, buildAgentsTemplate("manual"), "utf8");

    const summary = await configureAgents(repoRoot, "manual", {
      interactive: false,
    });

    expect(summary.enabledAgents).toEqual(
      enabledIdsForProviders("claude", "codex"),
    );
    expect(summary.agentCount).toBe(FULL_CATALOG_IDS.length);
    expect(summary.zeroDetections).toBe(false);
    expect(summary.detectedProviders).toEqual([
      { provider: "claude", binary: detectedBinaries.claude },
      { provider: "codex", binary: detectedBinaries.codex },
    ]);
    expect(summary.providerEnablementPrompted).toBe(false);

    const updated = await readFile(configPath, "utf8");
    const parsed = readAgentsConfig(updated);
    expect(parsed.agents).toHaveLength(FULL_CATALOG_IDS.length);
    for (const entry of parsed.agents) {
      expect(entry.enabled).toBe(
        entry.provider === "claude" || entry.provider === "codex",
      );
      const expectedBinary =
        entry.provider === "claude"
          ? detectedBinaries.claude
          : entry.provider === "codex"
            ? detectedBinaries.codex
            : "";
      expect(entry.binary).toBe(expectedBinary);
    }
  });

  it("preserves explicit disabled entries on init reruns", async () => {
    await mockDetectedBinaries(repoRoot, {
      claude: "/usr/bin/claude",
      codex: "/usr/bin/codex",
      gemini: "/usr/bin/gemini",
    });

    const configPath = join(repoRoot, ".voratiq", "agents.yaml");
    const template = readAgentsConfig(buildAgentsTemplate("pro"));
    const codexId = CODEX_DEFAULT_ID;
    const entries = template.agents.map((entry) =>
      entry.id === codexId ? { ...entry, enabled: false } : entry,
    );
    await writeFile(configPath, serializeAgentsConfigEntries(entries), "utf8");

    const summary = await configureAgents(repoRoot, "lite", {
      interactive: false,
    });

    const updated = readAgentsConfig(await readFile(configPath, "utf8"));
    const codexEntry = updated.agents.find((entry) => entry.id === codexId);
    expect(codexEntry?.enabled).toBe(false);
    expect(summary.enabledAgents).not.toContain(codexId);
  });
});

async function mockDetectedBinaries(
  root: string,
  binaries: Record<string, string>,
): Promise<Record<string, string>> {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const detectedPaths: Record<string, string> = {};

  for (const [provider, binaryPath] of Object.entries(binaries)) {
    const binaryName = provider;
    const filePath = join(binDir, binaryName);
    await writeFile(filePath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(filePath, 0o755);
    expect(binaryPath).toBe(`/usr/bin/${provider}`);
    detectedPaths[provider] = filePath;
  }

  process.env.PATH = binDir;
  return detectedPaths;
}
