import {
  DEFAULT_AGENT_DEFAULTS,
  getAgentDefaultId,
  getSupportedAgentDefaults,
  LITE_AGENT_DEFAULTS,
} from "../../src/configs/agents/defaults.js";
import {
  buildAgentsTemplate,
  buildDefaultAgentsTemplate,
  buildDefaultSandboxTemplate,
  listAgentPresetTemplates,
  serializeAgentsConfigEntries,
} from "../../src/workspace/templates.js";

describe("buildDefaultAgentsTemplate", () => {
  it("includes expected preset ids", () => {
    const yaml = buildDefaultAgentsTemplate();
    for (const agentDefault of DEFAULT_AGENT_DEFAULTS) {
      const id = getAgentDefaultId(agentDefault);
      expect(yaml).toContain(`id: ${id}`);
    }
  });
});

describe("buildAgentsTemplate", () => {
  it("builds lite preset with expected models", () => {
    const yaml = buildAgentsTemplate("lite");
    for (const agentDefault of LITE_AGENT_DEFAULTS) {
      expect(yaml).toContain(`model: ${agentDefault.model}`);
    }
  });

  it("includes the full supported catalog for every preset", () => {
    const presets = ["pro", "lite", "manual"] as const;
    for (const preset of presets) {
      const yaml = buildAgentsTemplate(preset);
      for (const agentDefault of getSupportedAgentDefaults()) {
        expect(yaml).toContain(`id: ${getAgentDefaultId(agentDefault)}`);
        expect(yaml).toContain(`model: ${agentDefault.model}`);
      }
    }
  });

  it("includes default extraArgs for variant agents", () => {
    const yaml = buildAgentsTemplate("pro");
    expect(yaml).toContain("id: gpt-5-3-codex-high");
    expect(yaml).toContain("id: gpt-5-2-codex-xhigh");
    expect(yaml).toContain("extraArgs:");
    expect(yaml).toContain("- --config");
    expect(yaml).toContain('- "model_reasoning_effort=high"');
    expect(yaml).toContain('- "model_reasoning_effort=xhigh"');
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
      "    binary: /opt/claude",
      "    extraArgs:",
      "      - --foo",
      "      - bar",
    ]);
  });

  it("represents empty entries as an empty list", () => {
    const yaml = serializeAgentsConfigEntries([]);
    expect(yaml.trim()).toBe("agents: []");
  });
});

describe("buildDefaultSandboxTemplate", () => {
  it("emits an empty providers mapping", () => {
    const yaml = buildDefaultSandboxTemplate();

    const lines = ["providers:", "  claude: {}", "  codex: {}", "  gemini: {}"];
    expect(yaml.trim()).toBe(lines.join("\n"));
  });
});

describe("listAgentPresetTemplates", () => {
  it("lists templates for every preset", () => {
    const descriptors = listAgentPresetTemplates();
    const presets = descriptors.map((descriptor) => descriptor.preset);
    expect(presets.sort()).toEqual(["lite", "manual", "pro"].sort());
  });

  it("emits deterministic templates without binary paths", () => {
    const descriptors = listAgentPresetTemplates();
    for (const descriptor of descriptors) {
      expect(descriptor.template).toContain('binary: ""');
      expect(descriptor.template).not.toContain("enabled: true");
      expect(descriptor.template).not.toMatch(/binary:\s*\//);
      expect(descriptor.template).not.toMatch(/binary:\s*[A-Za-z]:\\/);

      for (const agentDefault of getSupportedAgentDefaults()) {
        expect(descriptor.template).toContain(`model: ${agentDefault.model}`);
      }
    }
  });
});
