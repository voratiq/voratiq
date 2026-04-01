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

import { executeInitCommand } from "../../../src/commands/init/command.js";
import {
  getAgentDefaultId,
  getAgentDefaultsForPreset,
} from "../../../src/configs/agents/defaults.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import { buildDefaultOrchestrationTemplate } from "../../../src/configs/orchestration/bootstrap.js";
import { readOrchestrationConfig } from "../../../src/configs/orchestration/loader.js";
import { buildAgentsTemplate } from "../../../src/workspace/templates.js";

describe("init orchestration bootstrap", () => {
  let repoRoot: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-init-orchestration-"));
    originalPath = process.env.PATH;
    process.env.PATH = "";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("creates orchestration.yaml from preset defaults when missing", async () => {
    await mockDetectedBinaries(repoRoot, {
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
    const presetDefaults = getAgentDefaultsForPreset("pro");
    const allIds = presetDefaults.map((agent) => getAgentDefaultId(agent));
    const nonRunOnlyIds = presetDefaults
      .filter((agent) => !agent.runOnly)
      .map((agent) => getAgentDefaultId(agent));
    expect(orchestration.profiles.default.spec.agents.map((a) => a.id)).toEqual(
      nonRunOnlyIds,
    );
    expect(
      orchestration.profiles.default.run.agents.map((agent) => agent.id),
    ).toEqual(allIds);
    expect(
      orchestration.profiles.default.verify.agents.map((a) => a.id),
    ).toEqual(nonRunOnlyIds);
    expect(
      orchestration.profiles.default.reduce.agents.map((a) => a.id),
    ).toEqual(nonRunOnlyIds);
  });

  it("seeds lite run from detected enabled providers only", async () => {
    await mockDetectedBinaries(repoRoot, {
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

    const liteDefaults = getAgentDefaultsForPreset("lite").filter(
      (agent) => agent.provider === "codex" || agent.provider === "gemini",
    );
    const allIds = liteDefaults.map((agent) => getAgentDefaultId(agent));
    const nonRunOnlyIds = liteDefaults
      .filter((agent) => !agent.runOnly)
      .map((agent) => getAgentDefaultId(agent));
    const runIds = orchestration.profiles.default.run.agents.map(
      (agent) => agent.id,
    );
    const specIds = orchestration.profiles.default.spec.agents.map(
      (agent) => agent.id,
    );
    const verifyIds = orchestration.profiles.default.verify.agents.map(
      (agent) => agent.id,
    );
    const reduceIds = orchestration.profiles.default.reduce.agents.map(
      (agent) => agent.id,
    );

    expect(runIds).toEqual(allIds);
    expect(specIds).toEqual(nonRunOnlyIds);
    expect(verifyIds).toEqual(nonRunOnlyIds);
    expect(reduceIds).toEqual(nonRunOnlyIds);
  });

  it("recreates missing orchestration.yaml with seeding from updated preset", async () => {
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    await writeFile(
      join(repoRoot, ".voratiq", "agents.yaml"),
      buildAgentsTemplate("lite"),
      "utf8",
    );

    await mockDetectedBinaries(repoRoot, {
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

    const liteDefaults = getAgentDefaultsForPreset("lite").filter(
      (agent) => agent.provider === "codex" || agent.provider === "gemini",
    );
    const allIds = liteDefaults.map((agent) => getAgentDefaultId(agent));
    const nonRunOnlyIds = liteDefaults
      .filter((agent) => !agent.runOnly)
      .map((agent) => getAgentDefaultId(agent));

    expect(orchestration.profiles.default.spec.agents.map((a) => a.id)).toEqual(
      nonRunOnlyIds,
    );
    expect(
      orchestration.profiles.default.run.agents.map((agent) => agent.id),
    ).toEqual(allIds);
    expect(
      orchestration.profiles.default.verify.agents.map((a) => a.id),
    ).toEqual(nonRunOnlyIds);
    expect(
      orchestration.profiles.default.reduce.agents.map((a) => a.id),
    ).toEqual(nonRunOnlyIds);
  });

  it("seeds empty stage agent lists for manual preset", async () => {
    await mockDetectedBinaries(repoRoot, {
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
    expect(orchestration.profiles.default.verify.agents).toEqual([]);
    expect(orchestration.profiles.default.reduce.agents).toEqual([]);
  });

  it("seeds defaults in interactive mode without provider confirmation", async () => {
    await mockDetectedBinaries(repoRoot, {
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
    const proDefaults = getAgentDefaultsForPreset("pro");
    const allIds = proDefaults.map((agent) => getAgentDefaultId(agent));
    const nonRunOnlyIds = proDefaults
      .filter((agent) => !agent.runOnly)
      .map((agent) => getAgentDefaultId(agent));

    expect(orchestration.profiles.default.spec.agents.map((a) => a.id)).toEqual(
      nonRunOnlyIds,
    );
    expect(
      orchestration.profiles.default.run.agents.map((agent) => agent.id),
    ).toEqual(allIds);
    expect(
      orchestration.profiles.default.verify.agents.map((a) => a.id),
    ).toEqual(nonRunOnlyIds);
    expect(
      orchestration.profiles.default.reduce.agents.map((a) => a.id),
    ).toEqual(nonRunOnlyIds);
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
        "    reduce:",
        "      agents: []",
        "    verify:",
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
        "    reduce:",
        "      agents: []",
        "    verify:",
        "      agents: []",
        "",
      ].join("\n"),
    );
  });
});

async function mockDetectedBinaries(
  root: string,
  binaries: Record<string, string>,
): Promise<void> {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });

  for (const provider of Object.keys(binaries)) {
    const filePath = join(binDir, provider);
    await writeFile(filePath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(filePath, 0o755);
  }

  process.env.PATH = binDir;
}
