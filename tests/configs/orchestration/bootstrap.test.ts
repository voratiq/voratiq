import { describe, expect, test } from "@jest/globals";

import type { AgentsConfig } from "../../../src/configs/agents/types.js";
import {
  buildDefaultOrchestrationTemplate,
  listEnabledAgentIdsForOrchestrationBootstrap,
  listPresetStageAgentIdsForOrchestrationBootstrap,
} from "../../../src/configs/orchestration/bootstrap.js";

describe("orchestration bootstrap generator", () => {
  test("seeds spec/review empty and seeds run from preset stage agents", () => {
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
      listPresetStageAgentIdsForOrchestrationBootstrap(config, "pro"),
    ).toEqual(["zeta", "alpha"]);

    const yaml = buildDefaultOrchestrationTemplate(config, "pro");
    expect(yaml).toBe(
      [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "",
        "    run:",
        "      agents:",
        "        - id: zeta",
        "        - id: alpha",
        "",
        "    review:",
        "      agents: []",
        "",
      ].join("\n"),
    );
  });

  test("manual preset seeds empty run/review/spec", () => {
    const config: AgentsConfig = {
      agents: [
        {
          id: "codex",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "/usr/local/bin/codex",
        },
      ],
    };

    expect(
      listPresetStageAgentIdsForOrchestrationBootstrap(config, "manual"),
    ).toEqual([]);
    expect(buildDefaultOrchestrationTemplate(config, "manual")).toBe(
      [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "",
        "    run:",
        "      agents: []",
        "",
        "    review:",
        "      agents: []",
        "",
      ].join("\n"),
    );
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
      listPresetStageAgentIdsForOrchestrationBootstrap(config, "pro"),
    ).toEqual(["gemini"]);
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
});
