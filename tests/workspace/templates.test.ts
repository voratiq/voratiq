import {
  DEFAULT_AGENT_DEFAULTS,
  LITE_AGENT_DEFAULTS,
} from "../../src/configs/agents/defaults.js";
import {
  buildAgentsTemplate,
  buildDefaultAgentsTemplate,
  buildDefaultSandboxTemplate,
  listAgentPresetTemplates,
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

describe("buildAgentsTemplate", () => {
  it("builds lite preset with expected models", () => {
    const yaml = buildAgentsTemplate("lite");
    for (const agentDefault of LITE_AGENT_DEFAULTS) {
      expect(yaml).toContain(`model: ${agentDefault.model}`);
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

    const manual = descriptors.find((d) => d.preset === "manual");
    expect(manual?.template.trim()).toBe("agents: []");

    const nonManual = descriptors.filter((d) => d.preset !== "manual");
    for (const descriptor of nonManual) {
      expect(descriptor.template).toContain('binary: ""');
      expect(descriptor.template).not.toMatch(/binary:\s*\//);
      expect(descriptor.template).not.toMatch(/binary:\s*[A-Za-z]:\\/);
    }
  });
});
