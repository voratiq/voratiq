import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  AgentBinaryAccessError,
  AgentBinaryMissingError,
  AgentDisabledError,
  AgentNotFoundError,
  AgentsYamlParseError,
  UnknownAgentProviderTemplateError,
} from "../../../src/configs/agents/errors.js";
import {
  loadAgentById,
  loadAgentCatalog,
} from "../../../src/configs/agents/loader.js";

type AgentsFileFactory =
  | string
  | ((context: {
      root: string;
      createBinary: (relativePath?: string) => string;
    }) => string);

function withTempWorkspace(
  agentsFileContent: AgentsFileFactory,
  callback: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "voratiq-agents-test-"));
  const voratiqDir = join(root, ".voratiq");
  mkdirSync(voratiqDir, { recursive: true });
  const agentsPath = join(voratiqDir, "agents.yaml");
  let binaryCounter = 0;
  const createBinary = (relativePath?: string): string => {
    const targetRelative =
      relativePath ?? join("bin", `agent-bin-${binaryCounter++}.sh`);
    const resolved = join(root, targetRelative);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, "#!/usr/bin/env bash\nexit 0\n", {
      encoding: "utf8",
      mode: 0o755,
    });
    return resolved;
  };

  const agentsContent =
    typeof agentsFileContent === "function"
      ? agentsFileContent({ root, createBinary })
      : agentsFileContent;

  writeFileSync(agentsPath, agentsContent, "utf8");

  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("loadAgentCatalog", () => {
  it("treats missing enabled as enabled", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        const geminiBinary = createBinary("bin/gemini");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
  - id: gemini
    provider: gemini
    model: gemini-2.0
    enabled: false
    binary: ${geminiBinary}
`;
      },
      (root) => {
        const catalog = loadAgentCatalog({ root });
        expect(catalog.map((entry) => entry.id)).toEqual(["codex"]);
      },
    );
  });

  it("uses provider argv for built-in agents", () => {
    let codexBinaryPath = "";
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        codexBinaryPath = codexBinary;
        const geminiBinary = createBinary("bin/gemini");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
  - id: gemini
    provider: gemini
    model: gemini-2.0
    enabled: false
    binary: ${geminiBinary}
`;
      },
      (root) => {
        const catalog = loadAgentCatalog({ root });

        expect(catalog).toHaveLength(1);
        const codex = catalog[0];
        expect(codex.id).toBe("codex");
        expect(codex.model).toBe("o4-mini");
        expect(codex.binary).toBe(codexBinaryPath);
        expect(codex.provider).toBe("codex");
        expect(codex.argv).toEqual([
          "exec",
          "--model",
          "o4-mini",
          "--experimental-json",
          "--dangerously-bypass-approvals-and-sandbox",
          "-c",
          "mcp_servers={}",
        ]);
      },
    );
  });

  it("appends extraArgs to the generated argv", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    extraArgs:
      - --config
      - model_reasoning_effort=high
`;
      },
      (root) => {
        const catalog = loadAgentCatalog({ root });
        expect(catalog).toHaveLength(1);
        const codex = catalog[0];
        expect(codex?.argv).toEqual([
          "exec",
          "--model",
          "o4-mini",
          "--experimental-json",
          "--dangerously-bypass-approvals-and-sandbox",
          "-c",
          "mcp_servers={}",
          "--config",
          "model_reasoning_effort=high",
        ]);
      },
    );
  });

  it("rejects empty extraArgs arrays", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    extraArgs: []
`;
      },
      (root) => {
        expect(() => loadAgentCatalog({ root })).toThrow(/extraArgs/u);
      },
    );
  });

  it("rejects null extraArgs entries", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    extraArgs: null
`;
      },
      (root) => {
        expect(() => loadAgentCatalog({ root })).toThrow(/extraArgs/u);
      },
    );
  });

  it("fails when extraArgs contains the model placeholder", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    extraArgs:
      - "{{MODEL}}"
`;
      },
      (root) => {
        const load = () => loadAgentCatalog({ root });
        expect(load).toThrow(AgentsYamlParseError);
        expect(load).toThrow(/extraArgs/u);
      },
    );
  });

  it("fails when extraArgs repeats --model", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    extraArgs:
      - --model
      - other-model
`;
      },
      (root) => {
        const load = () => loadAgentCatalog({ root });
        expect(load).toThrow(AgentsYamlParseError);
        expect(load).toThrow(/--model/u);
      },
    );
  });

  it("supports multiple agents sharing a provider template", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        const codexBinaryHigh = createBinary("bin/codex-high");
        return `
agents:
  - id: codex-low
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    extraArgs:
      - --config
      - model_reasoning_effort=low
  - id: codex-high
    provider: codex
    model: o4-preview
    binary: ${codexBinaryHigh}
    extraArgs:
      - --config
      - model_reasoning_effort=high
`;
      },
      (root) => {
        const catalog = loadAgentCatalog({ root });
        expect(catalog).toHaveLength(2);
        const [low, high] = catalog;
        expect(low?.argv.slice(-2)).toEqual([
          "--config",
          "model_reasoning_effort=low",
        ]);
        expect(high?.argv.slice(-2)).toEqual([
          "--config",
          "model_reasoning_effort=high",
        ]);
      },
    );
  });

  it("throws when a binary path is omitted", () => {
    withTempWorkspace(
      () => `
agents:
  - id: codex
    provider: codex
    model: o4-mini
`,
      (root) => {
        expect(() => loadAgentCatalog({ root })).toThrow(
          AgentBinaryMissingError,
        );
      },
    );
  });

  it("throws when the binary path does not exist", () => {
    withTempWorkspace(
      ({ root }) => {
        const missingBinary = join(root, "bin", "codex-missing");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${missingBinary}
`;
      },
      (root) => {
        const load = () => loadAgentCatalog({ root });
        expect(load).toThrow(AgentBinaryAccessError);
        expect(load).toThrow(/binary ".*" is not executable/iu);
      },
    );
  });

  it("throws when provider reference is unknown", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const customBinary = createBinary("bin/custom");
        return `
agents:
  - id: custom
    provider: mystic
    model: custom-model
    binary: ${customBinary}
`;
      },
      (root) => {
        expect(() => loadAgentCatalog({ root })).toThrow(
          UnknownAgentProviderTemplateError,
        );
      },
    );
  });

  it("throws when enabled agent ids duplicate", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        const codexBinary2 = createBinary("bin/codex2");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
  - id: codex
    provider: codex
    model: o4-preview
    binary: ${codexBinary2}
`;
      },
      (root) => {
        expect(() => loadAgentCatalog({ root })).toThrow(
          /Duplicate enabled agent id "codex"/u,
        );
      },
    );
  });

  it("throws when agents.yaml is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "voratiq-agents-missing-"));
    try {
      mkdirSync(join(root, ".voratiq"), { recursive: true });
      expect(() => loadAgentCatalog({ root })).toThrow(/agents.yaml/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadAgentById", () => {
  it("loads a single enabled agent using shared validations", () => {
    let codexBinaryPath = "";
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        codexBinaryPath = codexBinary;
        const geminiBinary = createBinary("bin/gemini");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
  - id: gemini
    provider: gemini
    model: gemini-2.0
    binary: ${geminiBinary}
    enabled: false
`;
      },
      (root) => {
        const agent = loadAgentById("codex", { root });

        expect(agent.id).toBe("codex");
        expect(agent.model).toBe("o4-mini");
        expect(agent.binary).toBe(codexBinaryPath);
        expect(agent.argv).toEqual([
          "exec",
          "--model",
          "o4-mini",
          "--experimental-json",
          "--dangerously-bypass-approvals-and-sandbox",
          "-c",
          "mcp_servers={}",
        ]);
      },
    );
  });

  it("throws AgentNotFoundError with available enabled agents when id is missing", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const betaBinary = createBinary("bin/beta");
        const alphaBinary = createBinary("bin/alpha");
        return `
agents:
  - id: beta
    provider: codex
    model: o4-mini
    binary: ${betaBinary}
  - id: alpha
    provider: codex
    model: o4-mini
    binary: ${alphaBinary}
`;
      },
      (root) => {
        const load = () => loadAgentById("missing", { root });
        expect(load).toThrow(AgentNotFoundError);
        expect(load).toThrow(/Enabled agents: alpha, beta/u);
      },
    );
  });

  it("throws AgentDisabledError when the agent is disabled", () => {
    withTempWorkspace(
      ({ createBinary }) => {
        const codexBinary = createBinary("bin/codex");
        return `
agents:
  - id: codex
    provider: codex
    model: o4-mini
    binary: ${codexBinary}
    enabled: false
`;
      },
      (root) => {
        expect(() => loadAgentById("codex", { root })).toThrow(
          AgentDisabledError,
        );
      },
    );
  });
});
