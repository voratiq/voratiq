import { describe, expect, test } from "@jest/globals";

import type { AgentsConfig } from "../../../src/configs/agents/types.js";
import {
  buildDefaultOrchestrationTemplate,
  listEnabledAgentIdsForOrchestrationBootstrap,
  listPresetStageAgentsForOrchestrationBootstrap,
} from "../../../src/configs/orchestration/bootstrap.js";
import { readOrchestrationConfig } from "../../../src/configs/orchestration/loader.js";

describe("orchestration bootstrap generator", () => {
  test("seeds all stages from preset, with run-only agents only in run", () => {
    const config: AgentsConfig = {
      agents: [
        {
          id: "zeta",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
        {
          id: "alpha",
          provider: "gemini",
          model: "gemini-2.5-pro",
          enabled: true,
          binary: "/usr/local/bin/gemini",
        },
        {
          id: "skipped",
          provider: "claude",
          model: "claude-sonnet",
          enabled: false,
          binary: "/usr/local/bin/claude",
        },
      ],
    };

    expect(listEnabledAgentIdsForOrchestrationBootstrap(config)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect(
      listPresetStageAgentsForOrchestrationBootstrap(config, "pro"),
    ).toEqual([{ id: "zeta" }, { id: "alpha", runOnly: true }]);

    const yaml = buildDefaultOrchestrationTemplate(config, "pro");
    const orchestration = readOrchestrationConfig(yaml);

    expect(orchestration.profiles.default.run.agents.map((a) => a.id)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect(orchestration.profiles.default.spec.agents.map((a) => a.id)).toEqual(
      ["zeta"],
    );
    expect(orchestration.profiles.pro.run.agents.map((a) => a.id)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect(orchestration.profiles.lite.run.agents.map((a) => a.id)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect(yaml).toContain("      agents:\n        - id: zeta\n\n  pro:");
    expect(yaml).toContain("      agents:\n        - id: zeta\n\n  lite:");
  });

  test("manual preset keeps default empty while exposing pro and lite profiles", () => {
    const config: AgentsConfig = {
      agents: [
        {
          id: "claude-haiku-4-5-20251001",
          provider: "claude",
          model: "claude-haiku-4-5-20251001",
          enabled: true,
          binary: "/usr/local/bin/claude",
        },
        {
          id: "codex",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
        {
          id: "gemini",
          provider: "gemini",
          model: "gemini-2.5-pro",
          enabled: true,
          binary: "/usr/local/bin/gemini",
        },
      ],
    };

    expect(
      listPresetStageAgentsForOrchestrationBootstrap(config, "manual"),
    ).toEqual([]);

    const orchestration = readOrchestrationConfig(
      buildDefaultOrchestrationTemplate(config, "manual"),
    );

    expect(orchestration.profiles.default.spec.agents).toEqual([]);
    expect(orchestration.profiles.default.run.agents).toEqual([]);
    expect(orchestration.profiles.default.reduce.agents).toEqual([]);
    expect(orchestration.profiles.default.verify.agents).toEqual([]);
    expect(orchestration.profiles.default.message.agents).toEqual([]);
    expect(orchestration.profiles.pro.run.agents).toHaveLength(3);
    expect(orchestration.profiles.lite.run.agents).toHaveLength(3);
  });

  test("run-stage seeding ignores enabled entries without binaries", () => {
    const config: AgentsConfig = {
      agents: [
        {
          id: "codex",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "",
        },
        {
          id: "gemini",
          provider: "gemini",
          model: "gemini-2.5-pro",
          enabled: true,
          binary: "/usr/local/bin/gemini",
        },
      ],
    };

    expect(
      listPresetStageAgentsForOrchestrationBootstrap(config, "pro"),
    ).toEqual([{ id: "gemini", runOnly: true }]);
  });

  test("deduplicates enabled ids while preserving first declaration order", () => {
    const config: AgentsConfig = {
      agents: [
        {
          id: "codex",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
        {
          id: "codex",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
      ],
    };

    expect(listEnabledAgentIdsForOrchestrationBootstrap(config)).toEqual([
      "codex",
    ]);
  });

  test("serializes 64-character agent ids without quotes", () => {
    const agentId = "a".repeat(64);
    const config: AgentsConfig = {
      agents: [
        {
          id: agentId,
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
      ],
    };

    const yaml = buildDefaultOrchestrationTemplate(config, "pro");
    expect(yaml).toContain(`        - id: ${agentId}`);
  });

  test("non-run-only agents appear in all stages", () => {
    const config: AgentsConfig = {
      agents: [
        {
          id: "claude-opus-4-6",
          provider: "claude",
          model: "claude-opus-4-6",
          enabled: true,
          binary: "/usr/local/bin/claude",
        },
        {
          id: "gpt-5-4-high",
          provider: "codex",
          model: "gpt-5.4",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
      ],
    };

    const yaml = buildDefaultOrchestrationTemplate(config, "pro");
    const lines = yaml.split("\n");

    // Both agents in all stages
    for (const stage of ["spec", "run", "reduce", "verify", "message"]) {
      const stageStart = lines.indexOf(`    ${stage}:`);
      expect(stageStart).toBeGreaterThan(-1);
      const agentsLine = lines[stageStart + 1];
      expect(agentsLine).toBe("      agents:");
    }
  });
});
