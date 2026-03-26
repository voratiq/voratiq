import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveReductionCompetitors } from "../../../src/commands/shared/resolve-reduction-competitors.js";
import { HintedError } from "../../../src/utils/errors.js";

describe("resolveReductionCompetitors", () => {
  it("reports duplicate CLI ids using the provided override flag name", () => {
    expect(() =>
      resolveReductionCompetitors({
        root: "/unused",
        cliAgentIds: ["alpha", "alpha"],
        cliOverrideFlag: "--reduce-agent",
      }),
    ).toThrow("Duplicate `--reduce-agent` values for reduce.");
  });

  it("reports missing reducer configuration with actionable guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-missing-"));
    try {
      await writeOrchestrationFixture(root, [
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
      ]);

      let caught: unknown;
      try {
        resolveReductionCompetitors({
          root,
          includeDefinitions: false,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HintedError);
      const hinted = caught as HintedError;
      expect(hinted.headline).toBe("No reducer agents configured.");
      expect(hinted.hintLines).toContain(
        "Configure at least one agent under `profiles.default.reduce.agents` in `orchestration.yaml`.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves reducer agents from the selected profile in configured order", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-profile-"));
    try {
      await writeOrchestrationFixture(root, [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents: []",

        "    reduce:",
        "      agents:",
        "        - id: alpha",
        "    verify:",
        "      agents: []",
        "  quality:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents: []",

        "    reduce:",
        "      agents:",
        "        - id: gamma",
        "        - id: beta",
        "        - id: alpha",
        "    verify:",
        "      agents: []",
        "",
      ]);

      const resolution = resolveReductionCompetitors({
        root,
        profileName: "quality",
        includeDefinitions: false,
      });

      expect(resolution.source).toBe("orchestration");
      expect(resolution.agentIds).toEqual(["gamma", "beta", "alpha"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps CLI overrides higher precedence than selected profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-cli-"));
    try {
      await writeOrchestrationFixture(root, [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents: []",

        "    reduce:",
        "      agents:",
        "        - id: alpha",
        "    verify:",
        "      agents: []",
        "",
      ]);

      const resolution = resolveReductionCompetitors({
        root,
        cliAgentIds: ["beta", "gamma"],
        cliOverrideFlag: "--reduce-agent",
        includeDefinitions: false,
      });

      expect(resolution.source).toBe("cli");
      expect(resolution.agentIds).toEqual(["beta", "gamma"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeOrchestrationFixture(
  root: string,
  orchestrationLines: readonly string[],
): Promise<void> {
  await mkdir(join(root, ".voratiq"), { recursive: true });
  await writeFile(
    join(root, ".voratiq", "orchestration.yaml"),
    `${orchestrationLines.join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(root, ".voratiq", "agents.yaml"),
    [
      "agents:",
      "  - id: alpha",
      '    provider: "codex"',
      '    model: "gpt-5"',
      "    enabled: true",
      '    binary: "/bin/echo"',
      "  - id: beta",
      '    provider: "codex"',
      '    model: "gpt-5"',
      "    enabled: true",
      '    binary: "/bin/echo"',
      "  - id: gamma",
      '    provider: "codex"',
      '    model: "gpt-5"',
      "    enabled: true",
      '    binary: "/bin/echo"',
      "",
    ].join("\n"),
    "utf8",
  );
}
