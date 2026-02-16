import type {
  AgentInitSummary,
  EnvironmentInitSummary,
  EvalInitSummary,
  InitCommandResult,
  OrchestrationInitSummary,
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
    agentCount: 3,
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

  const baseOrchestration: OrchestrationInitSummary = {
    configPath: ".voratiq/orchestration.yaml",
    configCreated: false,
  };

  it("renders agent and eval summaries with workspace creation", () => {
    const view: InitCommandResult = {
      workspaceResult: resultCreated,
      agentSummary: baseAgents,
      orchestrationSummary: baseOrchestration,
      environmentSummary: baseEnvironment,
      evalSummary: baseEvals,
      sandboxSummary: baseSandbox,
    };

    const output = renderInitTranscript(view);
    const lines = output.split("\n");

    expect(lines[0]).toBe("Agents configured (claude, codex, gemini).");
    expect(lines[1]).toBe("To modify, edit `.voratiq/agents.yaml`.");
    expect(lines[3]).toBe("Orchestration configured.");
    expect(lines[4]).toBe("To modify, edit `.voratiq/orchestration.yaml`.");
    expect(output).toContain("Environment configured (node).");
    expect(output).toContain(
      "Evals configured (format, lint, typecheck, tests).",
    );
    expect(output).toContain("Sandbox configured.");
    expect(output).toContain("Orchestration configured.");
    expect(output).toContain("To modify, edit `.voratiq/orchestration.yaml`.");
    expect(output).toContain(colorize("Voratiq initialized.", "green"));
    expect(output).toContain("To begin a run:\n  voratiq run --spec <path>");
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
      orchestrationSummary: baseOrchestration,
      environmentSummary: baseEnvironment,
      evalSummary: baseEvals,
      sandboxSummary: baseSandbox,
    };

    const output = renderInitTranscript(view);
    const lines = output.split("\n");

    expect(lines[0]).toBe(
      "No agents configured, unable to find agent binaries.",
    );
    expect(lines[1]).toBe(
      "To modify agent setup manually, edit `.voratiq/agents.yaml`.",
    );
    expect(output).toContain(colorize("Voratiq initialized.", "green"));
  });

  it("renders manual agent summaries without binary warnings", () => {
    const agents: AgentInitSummary = {
      configPath: ".voratiq/agents.yaml",
      enabledAgents: [],
      agentCount: 0,
      zeroDetections: true,
      configCreated: false,
      configUpdated: false,
    };

    const view: InitCommandResult = {
      workspaceResult: resultCreated,
      agentSummary: agents,
      orchestrationSummary: baseOrchestration,
      environmentSummary: baseEnvironment,
      evalSummary: baseEvals,
      sandboxSummary: baseSandbox,
    };

    const output = renderInitTranscript(view);
    const lines = output.split("\n");

    expect(lines[0]).toBe("Agents configured (none).");
    expect(output).not.toContain("unable to find agent binaries");
  });

  it("renders already-exists message when nothing new is created", () => {
    const result: CreateWorkspaceResult = {
      createdDirectories: [],
      createdFiles: [],
    };

    const view: InitCommandResult = {
      workspaceResult: result,
      agentSummary: baseAgents,
      orchestrationSummary: baseOrchestration,
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
