import { describe, expect, test } from "@jest/globals";

import type { AgentsConfig } from "../../../src/configs/agents/types.js";
import {
  buildDefaultOrchestrationTemplate,
  listEnabledAgentIdsForOrchestrationBootstrap,
} from "../../../src/configs/orchestration/bootstrap.js";

describe("orchestration bootstrap generator", () => {
  test("seeds staged defaults with spec/review empty and run enabled agents", () => {
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

    const yaml = buildDefaultOrchestrationTemplate(config);
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
