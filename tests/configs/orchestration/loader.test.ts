import { describe, expect, test } from "@jest/globals";

import {
  MissingOrchestrationConfigError,
  OrchestrationSchemaValidationError,
} from "../../../src/configs/orchestration/errors.js";
import { loadOrchestrationConfig } from "../../../src/configs/orchestration/loader.js";

const ROOT = "/repo";
const ORCHESTRATION_FILE = "/repo/.voratiq/orchestration.yaml";
const AGENTS_FILE = "/repo/.voratiq/agents.yaml";

function createReadFile(
  files: Record<string, string>,
): (path: string) => string {
  return (path) => {
    const content = files[path];
    if (typeof content === "string") {
      return content;
    }

    const error = new Error(
      `ENOENT: no such file or directory, open '${path}'`,
    ) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  };
}

function getThrownMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected action to throw.");
}

describe("loadOrchestrationConfig", () => {
  test("fails when orchestration.yaml is missing", () => {
    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [AGENTS_FILE]: `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`,
        }),
      });

    expect(load).toThrow(MissingOrchestrationConfigError);
    expect(load).toThrow(/Missing orchestration configuration file/u);
  });

  test("loads valid orchestration config", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
        - id: gemini
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: gemini
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
  - id: gemini
    provider: gemini
    model: gemini-2.5-pro
    enabled: true
    binary: /usr/local/bin/gemini
`;

    const config = loadOrchestrationConfig({
      root: ROOT,
      filePath: ORCHESTRATION_FILE,
      readFile: createReadFile({
        [ORCHESTRATION_FILE]: orchestrationYaml,
        [AGENTS_FILE]: agentsYaml,
      }),
    });

    expect(config.profiles.default.run.agents.map((agent) => agent.id)).toEqual(
      ["codex", "gemini"],
    );
    expect(
      config.profiles.default.review.agents.map((agent) => agent.id),
    ).toEqual(["codex"]);
    expect(
      config.profiles.default.spec.agents.map((agent) => agent.id),
    ).toEqual(["gemini"]);
  });

  test("allows empty stage agent arrays for run and spec", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents: []
    review:
      agents:
        - id: codex
    spec:
      agents: []
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const config = loadOrchestrationConfig({
      root: ROOT,
      filePath: ORCHESTRATION_FILE,
      readFile: createReadFile({
        [ORCHESTRATION_FILE]: orchestrationYaml,
        [AGENTS_FILE]: agentsYaml,
      }),
    });

    expect(config.profiles.default.run.agents).toEqual([]);
    expect(
      config.profiles.default.review.agents.map((agent) => agent.id),
    ).toEqual(["codex"]);
    expect(config.profiles.default.spec.agents).toEqual([]);
  });

  test("fails when legacy version key is present at top level", () => {
    const orchestrationYaml = `
version: 1
profiles:
  default:
    run:
      agents: []
    review:
      agents:
        - id: codex
    spec:
      agents: []
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(/unknown key "version"/u);
    const message = getThrownMessage(load);
    expect(message).not.toContain(".voratiq/orchestration.yaml");
  });

  test("fails on unknown top-level keys", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
unexpected: true
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(/unknown key "unexpected"/u);
  });

  test("fails when profiles contain non-default keys", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
  experimental:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(/profiles: unknown key "experimental"/u);
  });

  test("fails on unknown stage keys", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
    deploy:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(/profiles\.default: unknown key "deploy"/u);
  });

  test("fails when profiles.default.spec is missing", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(/profiles\.default\.spec/u);
  });

  test("fails when profiles.default.review is missing", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(/profiles\.default\.review/u);
  });

  test("fails on malformed stage agent definitions", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(/profiles\.default\.run\.agents\[0\]/u);
  });

  test("fails on duplicate stage agent ids within the same stage", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(/profiles\.default\.run\.agents\[1\]\.id/u);
    expect(load).toThrow(/duplicate stage agent id `codex`/u);
  });

  test("fails when stage references an unknown agent id", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: ghost
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(
      /agent `ghost` is not defined in \.voratiq\/agents\.yaml/u,
    );
    const message = getThrownMessage(load);
    expect(message).not.toContain("profiles.default.review.agents[0].id");
  });

  test("fails when run stage references an unknown agent id", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: ghost
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(
      /agent `ghost` is not defined in \.voratiq\/agents\.yaml/u,
    );
    const message = getThrownMessage(load);
    expect(message).not.toContain("profiles.default.run.agents[0].id");
  });

  test("fails when stage references a disabled agent id", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: false
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(OrchestrationSchemaValidationError);
    expect(load).toThrow(
      /agent `codex` is disabled in \.voratiq\/agents\.yaml/u,
    );
    const message = getThrownMessage(load);
    expect(message).not.toContain("profiles.default.run.agents[0].id");
  });

  test("fails when agents.yaml is missing during cross-validation", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
        }),
      });

    expect(load).toThrow(
      /cannot validate stage agents because .*agents\.yaml is missing/u,
    );
  });

  test("formats YAML parse errors without file path or location prefix", () => {
    const orchestrationYaml = `
profiles:
  default:
    run:
      agents:
        - id: codex
    review:
      agents:
        - id: codex
    spec:
      agents:
        - id: codex
      broken
`;
    const agentsYaml = `
agents:
  - id: codex
    provider: codex
    model: gpt-5
    enabled: true
    binary: /usr/local/bin/codex
`;

    const load = () =>
      loadOrchestrationConfig({
        root: ROOT,
        filePath: ORCHESTRATION_FILE,
        readFile: createReadFile({
          [ORCHESTRATION_FILE]: orchestrationYaml,
          [AGENTS_FILE]: agentsYaml,
        }),
      });

    expect(load).toThrow(/Invalid `orchestration\.yaml`: /u);
    const message = getThrownMessage(load);
    expect(message).not.toContain(".voratiq/orchestration.yaml");
    expect(message).not.toContain("(line ");
  });
});
