import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { HintedError } from "../../../src/utils/errors.js";

describe("resolveStageCompetitors", () => {
  it("reports duplicate CLI ids using the provided override flag name", () => {
    expect(() =>
      resolveStageCompetitors({
        root: "/unused",
        stageId: "run",
        cliAgentIds: ["alpha", "alpha"],
        cliOverrideFlag: "--run-agent",
      }),
    ).toThrow("Duplicate `--run-agent` values for stage `run`.");
  });

  it("reports single-agent guardrails using the provided override flag name", () => {
    let caught: unknown;
    try {
      resolveStageCompetitors({
        root: "/unused",
        stageId: "verify",
        cliAgentIds: ["alpha", "beta"],
        cliOverrideFlag: "--verify-agent",
        enforceSingleCompetitor: true,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HintedError);
    const hinted = caught as HintedError;
    expect(hinted.headline).toBe(
      "Multiple agents configured for stage `verify`.",
    );
    expect(hinted.hintLines).toContain(
      "Configure exactly one agent under `profiles.default.verify.agents` in `orchestration.yaml`.",
    );
  });

  it("reports missing stage resolution using the provided override flag name", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-stage-resolution-"));
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
        resolveStageCompetitors({
          root,
          stageId: "run",
          cliOverrideFlag: "--run-agent",
          includeDefinitions: false,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HintedError);
      const hinted = caught as HintedError;
      expect(hinted.headline).toBe("No agents configured for stage `run`.");
      expect(hinted.hintLines).toContain(
        "Configure at least one agent under `profiles.default.run.agents` in `orchestration.yaml`.",
      );
      expect(
        hinted.hintLines.some((line) =>
          line.includes("profiles.default.run.agents"),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves run stage agents from the selected profile in configured order", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-profile-resolution-"));
    try {
      await writeOrchestrationFixture(root, [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: alpha",

        "    reduce:",
        "      agents:",
        "        - id: alpha",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "  quality:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: gamma",
        "        - id: alpha",
        "        - id: beta",

        "    reduce:",
        "      agents:",
        "        - id: beta",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "",
      ]);

      const resolution = resolveStageCompetitors({
        root,
        stageId: "run",
        profileName: "quality",
        includeDefinitions: false,
      });

      expect(resolution.source).toBe("orchestration");
      expect(resolution.agentIds).toEqual(["gamma", "alpha", "beta"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses default profile when --profile is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-default-profile-"));
    try {
      await writeOrchestrationFixture(root, [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: beta",
        "        - id: alpha",

        "    reduce:",
        "      agents:",
        "        - id: alpha",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "  quality:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: gamma",

        "    reduce:",
        "      agents:",
        "        - id: gamma",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "",
      ]);

      const resolution = resolveStageCompetitors({
        root,
        stageId: "run",
        includeDefinitions: false,
      });

      expect(resolution.source).toBe("orchestration");
      expect(resolution.agentIds).toEqual(["beta", "alpha"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps CLI stage overrides higher precedence than selected profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-cli-precedence-"));
    try {
      await writeOrchestrationFixture(root, [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: alpha",

        "    reduce:",
        "      agents:",
        "        - id: alpha",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "  quality:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: beta",

        "    reduce:",
        "      agents:",
        "        - id: beta",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "",
      ]);

      const resolution = resolveStageCompetitors({
        root,
        stageId: "run",
        profileName: "quality",
        cliAgentIds: ["gamma", "beta"],
        cliOverrideFlag: "--run-agent",
        includeDefinitions: false,
      });

      expect(resolution.source).toBe("cli");
      expect(resolution.agentIds).toEqual(["gamma", "beta"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails fast for unknown profile names with actionable guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-unknown-profile-"));
    try {
      await writeOrchestrationFixture(root, [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: alpha",

        "    reduce:",
        "      agents:",
        "        - id: alpha",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "  quality:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents:",
        "        - id: beta",

        "    reduce:",
        "      agents:",
        "        - id: beta",
        "    verify:",
        "      agents:",
        "        - id: alpha",
        "",
      ]);

      let caught: unknown;
      try {
        resolveStageCompetitors({
          root,
          stageId: "run",
          profileName: "missing-profile",
          includeDefinitions: false,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HintedError);
      const hinted = caught as HintedError;
      expect(hinted.headline).toBe(
        "Unknown orchestration profile `missing-profile`.",
      );
      expect(hinted.detailLines).toContain(
        "Available profiles: `default`, `quality`.",
      );
      expect(hinted.hintLines).toEqual([
        "Review `--profile` and update `orchestration.yaml` if needed.",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves reduce through the shared stage resolver path", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-shared-reduce-"));
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
        "        - id: gamma",
        "        - id: alpha",
        "    verify:",
        "      agents: []",
        "",
      ]);

      const resolution = resolveStageCompetitors({
        root,
        stageId: "reduce",
        includeDefinitions: false,
      });

      expect(resolution.source).toBe("orchestration");
      expect(resolution.agentIds).toEqual(["gamma", "alpha"]);
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
