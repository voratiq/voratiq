import type {
  AgentInitSummary,
  EnvironmentInitSummary,
  EvalInitSummary,
  InitCommandResult,
  SandboxInitSummary,
} from "../../src/commands/init/types.js";
import { renderInitTranscript } from "../../src/render/transcripts/init.js";
import { colorize } from "../../src/utils/colors.js";
import type { CreateWorkspaceResult } from "../../src/workspace/types.js";

describe("renderInitTranscript", () => {
  const resultCreated: CreateWorkspaceResult = {
    createdDirectories: [".voratiq", ".voratiq/runs", ".voratiq/runs/sessions"],
    createdFiles: [".voratiq/runs/index.json"],
  };

  const baseAgents: AgentInitSummary = {
    configPath: ".voratiq/agents.yaml",
    enabledAgents: ["claude", "codex", "gemini"],
    zeroDetections: false,
    configCreated: false,
    configUpdated: true,
  };

  const baseEvals: EvalInitSummary = {
    configPath: ".voratiq/evals.yaml",
    configuredEvals: ["format", "lint", "typecheck", "tests"],
    configCreated: false,
    configUpdated: true,
  };

  const baseEnvironment: EnvironmentInitSummary = {
    configPath: ".voratiq/environment.yaml",
    detectedEntries: ["node"],
    configCreated: false,
    configUpdated: true,
    config: {
      node: { dependencyRoots: ["node_modules"] },
    },
  };

  const baseSandbox: SandboxInitSummary = {
    configPath: ".voratiq/sandbox.yaml",
    configCreated: false,
  };

  it("renders agent and eval summaries with workspace creation", () => {
    const view: InitCommandResult = {
      workspaceResult: resultCreated,
      agentSummary: baseAgents,
      environmentSummary: baseEnvironment,
      evalSummary: baseEvals,
      sandboxSummary: baseSandbox,
    };

    const output = renderInitTranscript(view);

    expect(output).toBe(
      [
        "Agents configured (claude, codex, gemini).",
        "To modify, edit `.voratiq/agents.yaml`.",
        "",
        "Environment configured (node).",
        "To modify, edit `.voratiq/environment.yaml`.",
        "",
        "Evals configured (format, lint, typecheck, tests).",
        "To modify, edit `.voratiq/evals.yaml`.",
        "",
        "Sandbox configured.",
        "To modify, edit `.voratiq/sandbox.yaml`.",
        "",
        colorize("Voratiq initialized.", "green"),
        "",
        "To begin a run:\n  voratiq run --spec <path>",
      ].join("\n"),
    );
  });

  it("includes detection hints when no binaries are found", () => {
    const agents: AgentInitSummary = {
      ...baseAgents,
      enabledAgents: [],
      zeroDetections: true,
      configUpdated: false,
    };

    const view: InitCommandResult = {
      workspaceResult: resultCreated,
      agentSummary: agents,
      environmentSummary: baseEnvironment,
      evalSummary: baseEvals,
      sandboxSummary: baseSandbox,
    };

    const output = renderInitTranscript(view);

    expect(output).toBe(
      [
        "No agents configured, unable to find agent binaries.",
        "To modify agent setup manually, edit `.voratiq/agents.yaml`.",
        "",
        "Environment configured (node).",
        "To modify, edit `.voratiq/environment.yaml`.",
        "",
        "Evals configured (format, lint, typecheck, tests).",
        "To modify, edit `.voratiq/evals.yaml`.",
        "",
        "Sandbox configured.",
        "To modify, edit `.voratiq/sandbox.yaml`.",
        "",
        colorize("Voratiq initialized.", "green"),
        "",
        "To begin a run:\n  voratiq run --spec <path>",
      ].join("\n"),
    );
  });

  it("renders already-exists message when nothing new is created", () => {
    const result: CreateWorkspaceResult = {
      createdDirectories: [],
      createdFiles: [],
    };

    const view: InitCommandResult = {
      workspaceResult: result,
      agentSummary: baseAgents,
      environmentSummary: baseEnvironment,
      evalSummary: baseEvals,
      sandboxSummary: baseSandbox,
    };

    const output = renderInitTranscript(view);

    expect(
      output.includes("To begin a run:\n  voratiq run --spec <path>"),
    ).toBe(true);
  });
});
