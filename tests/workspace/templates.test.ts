import { DEFAULT_AGENT_DEFAULTS } from "../../src/configs/agents/defaults.js";
import {
  buildDefaultAgentsTemplate,
  buildDefaultSandboxTemplate,
  sanitizeAgentIdFromModel,
  serializeAgentsConfigEntries,
} from "../../src/workspace/templates.js";

describe("buildDefaultAgentsTemplate", () => {
  it("derives ids from model slugs", () => {
    const yaml = buildDefaultAgentsTemplate();
    for (const agentDefault of DEFAULT_AGENT_DEFAULTS) {
      const id = sanitizeAgentIdFromModel(agentDefault.model);
      expect(yaml).toContain(`id: ${id}`);
    }
  });
});

describe("serializeAgentsConfigEntries", () => {
  it("orders base agent fields consistently", () => {
    const yaml = serializeAgentsConfigEntries([
      {
        id: "codex",
        provider: "codex",
        model: "gpt-5.1-codex",
        enabled: false,
        binary: "/usr/local/bin/codex",
      },
    ]);

    expect(yaml.trim().split("\n")).toEqual([
      "agents:",
      "  - id: codex",
      "    provider: codex",
      "    model: gpt-5.1-codex",
      "    enabled: false",
      "    binary: /usr/local/bin/codex",
    ]);
  });

  it("emits optional sections after the base field order", () => {
    const yaml = serializeAgentsConfigEntries([
      {
        id: "claude",
        provider: "claude",
        model: "claude-sonnet-4-5-20250929",
        enabled: true,
        binary: "/opt/claude",
        extraArgs: ["--foo", "bar"],
      },
    ]);

    expect(yaml.trim().split("\n")).toEqual([
      "agents:",
      "  - id: claude",
      "    provider: claude",
      "    model: claude-sonnet-4-5-20250929",
      "    enabled: true",
      "    binary: /opt/claude",
      "    extraArgs:",
      "      - --foo",
      "      - bar",
    ]);
  });
});

describe("buildDefaultSandboxTemplate", () => {
  it("emits an empty providers mapping", () => {
    const yaml = buildDefaultSandboxTemplate();

    const lines = ["providers:", "  claude: {}", "  codex: {}", "  gemini: {}"];
    expect(yaml.trim()).toBe(lines.join("\n"));
  });
});
