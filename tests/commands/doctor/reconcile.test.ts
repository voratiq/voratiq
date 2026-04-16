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

import { executeDoctorReconcile } from "../../../src/commands/doctor/reconcile.js";
import { readAgentsConfig } from "../../../src/configs/agents/loader.js";
import { readOrchestrationConfig } from "../../../src/configs/orchestration/loader.js";
import { readManagedState } from "../../../src/workspace/managed-state.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

describe("executeDoctorReconcile", () => {
  let repoRoot: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-doctor-reconcile-"));
    await mkdir(join(repoRoot, ".git"), { recursive: true });
    originalPath = process.env.PATH;
    process.env.PATH = "";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("bootstraps a missing workspace before reconciling managed config", async () => {
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
    });

    const result = await executeDoctorReconcile({ root: repoRoot });

    expect(result.workspaceBootstrapped).toBe(true);
    expect(result.agentSummary.detectedProviders).toHaveLength(1);
    expect(result.agentSummary.detectedProviders[0]).toMatchObject({
      provider: "codex",
    });
    expect(result.agentSummary.detectedProviders[0]?.binary).toContain(
      "/bin/codex",
    );

    const agentsConfig = readAgentsConfig(
      await readFile(join(repoRoot, ".voratiq", "agents.yaml"), "utf8"),
    );
    expect(
      agentsConfig.agents.some(
        (entry) =>
          entry.provider === "codex" && entry.binary.includes("/bin/codex"),
      ),
    ).toBe(true);

    const orchestration = readOrchestrationConfig(
      await readFile(join(repoRoot, ".voratiq", "orchestration.yaml"), "utf8"),
    );
    expect(orchestration.profiles.default.run.agents.length).toBeGreaterThan(0);

    const managedState = await readManagedState(repoRoot);
    expect(managedState?.configs.orchestration?.preset).toBe("pro");
  });

  it("updates managed orchestration when the workspace still matches managed state", async () => {
    await createWorkspace(repoRoot);
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
    });

    const before = await readFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      "utf8",
    );
    const result = await executeDoctorReconcile({ root: repoRoot });
    const after = await readFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      "utf8",
    );

    expect(result.workspaceBootstrapped).toBe(false);
    expect(result.orchestrationSummary.skippedCustomized).toBe(false);
    expect(result.orchestrationSummary.configUpdated).toBe(true);
    expect(after).not.toBe(before);
  });

  it("preserves customized orchestration during reconcile", async () => {
    await createWorkspace(repoRoot);
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
        "    message:",
        "      agents:",
        "        - id: custom-reviewer",
        "",
      ].join("\n"),
      "utf8",
    );
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
    });

    const initial = await readFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      "utf8",
    );
    const result = await executeDoctorReconcile({ root: repoRoot });
    const updated = await readFile(
      join(repoRoot, ".voratiq", "orchestration.yaml"),
      "utf8",
    );

    expect(result.orchestrationSummary.skippedCustomized).toBe(true);
    expect(updated).toBe(initial);
  });

  it("adopts a newly available provider into managed agents and orchestration", async () => {
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
    });

    await executeDoctorReconcile({ root: repoRoot });

    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
      claude: "/usr/local/bin/claude",
    });

    const result = await executeDoctorReconcile({ root: repoRoot });
    const agentsConfig = readAgentsConfig(
      await readFile(join(repoRoot, ".voratiq", "agents.yaml"), "utf8"),
    );
    const orchestration = readOrchestrationConfig(
      await readFile(join(repoRoot, ".voratiq", "orchestration.yaml"), "utf8"),
    );

    const claudeEntries = agentsConfig.agents.filter(
      (entry) => entry.provider === "claude",
    );

    expect(result.agentSummary.detectedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "claude",
        }),
      ]),
    );
    expect(claudeEntries).toHaveLength(7);
    for (const entry of claudeEntries) {
      expect(entry.enabled).toBe(true);
      expect(entry.binary).toContain("/bin/claude");
    }
    expect(orchestration.profiles.default.run.agents).toEqual([
      { id: "claude-opus-4-7-xhigh" },
      { id: "gpt-5-4-high" },
    ]);
    expect(orchestration.profiles.lite.run.agents).toEqual([
      { id: "claude-haiku-4-5-20251001" },
      { id: "gpt-5-4-mini" },
    ]);
  });

  it("adopts a newly available provider even when user-defined agents exist", async () => {
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
    });

    await executeDoctorReconcile({ root: repoRoot });

    await writeFile(
      join(repoRoot, ".voratiq", "agents.yaml"),
      `${await readFile(join(repoRoot, ".voratiq", "agents.yaml"), "utf8")}\n  - id: my-custom-agent\n    provider: codex\n    model: gpt-5.4\n    enabled: true\n    binary: /tmp/fake-codex\n`,
      "utf8",
    );

    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
      claude: "/usr/local/bin/claude",
    });

    const result = await executeDoctorReconcile({ root: repoRoot });
    const agentsConfig = readAgentsConfig(
      await readFile(join(repoRoot, ".voratiq", "agents.yaml"), "utf8"),
    );

    expect(result.agentSummary.managed).toBe(true);
    expect(
      agentsConfig.agents.find((entry) => entry.id === "my-custom-agent"),
    ).toMatchObject({
      provider: "codex",
      binary: "/tmp/fake-codex",
      enabled: true,
    });
    expect(
      agentsConfig.agents
        .filter((entry) => entry.provider === "claude")
        .every(
          (entry) =>
            entry.enabled === true && entry.binary.includes("/bin/claude"),
        ),
    ).toBe(true);
  });

  it("preserves previously detected provider binaries when they disappear temporarily", async () => {
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
      claude: "/usr/local/bin/claude",
    });

    await executeDoctorReconcile({ root: repoRoot });
    process.env.PATH = join(repoRoot, "bin");
    await rm(join(repoRoot, "bin", "claude"), { force: true });

    await executeDoctorReconcile({ root: repoRoot });

    const agentsConfig = readAgentsConfig(
      await readFile(join(repoRoot, ".voratiq", "agents.yaml"), "utf8"),
    );
    const claudeEntries = agentsConfig.agents.filter(
      (entry) => entry.provider === "claude",
    );

    expect(claudeEntries).toHaveLength(7);
    for (const entry of claudeEntries) {
      expect(entry.enabled).toBe(true);
      expect(entry.binary).toContain("/bin/claude");
    }
  });

  it("does not re-adopt customized orchestration on a later reconcile", async () => {
    await mockDetectedBinaries(repoRoot, {
      codex: "/usr/local/bin/codex",
    });

    await executeDoctorReconcile({ root: repoRoot });
    const orchestrationPath = join(repoRoot, ".voratiq", "orchestration.yaml");
    const customized = [
      "profiles:",
      "  default:",
      "    spec:",
      "      agents:",
      "        - id: custom-reviewer",
      "    run:",
      "      agents: []",
      "    reduce:",
      "      agents: []",
      "    verify:",
      "      agents: []",
      "    message:",
      "      agents: []",
      "",
    ].join("\n");
    await writeFile(orchestrationPath, customized, "utf8");

    const first = await executeDoctorReconcile({ root: repoRoot });
    const second = await executeDoctorReconcile({ root: repoRoot });
    const final = await readFile(orchestrationPath, "utf8");

    expect(first.orchestrationSummary.skippedCustomized).toBe(true);
    expect(second.orchestrationSummary.skippedCustomized).toBe(true);
    expect(final).toBe(customized);
  });
});

async function mockDetectedBinaries(
  root: string,
  binaries: Record<string, string>,
): Promise<void> {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });

  for (const [name, target] of Object.entries(binaries)) {
    const filePath = join(binDir, name);
    await writeFile(filePath, `#!/bin/sh\nexec "${target}" "$@"\n`, "utf8");
    await chmod(filePath, 0o755);
  }

  process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPathOrEmpty(process.env.PATH)}`;
}

function originalPathOrEmpty(value: string | undefined): string {
  return value ? value : "";
}
