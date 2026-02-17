import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Command } from "commander";

import * as harness from "../../src/agents/runtime/harness.js";
import * as sandboxRuntime from "../../src/agents/runtime/sandbox.js";
import { CliError } from "../../src/cli/errors.js";
import { createSpecCommand, runSpecCommand } from "../../src/cli/spec.js";
import { executeCompetitionWithAdapter } from "../../src/competition/command-adapter.js";
import * as preflight from "../../src/preflight/index.js";
import { renderCliError } from "../../src/render/utils/errors.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import { silenceCommander } from "../support/commander.js";
import {
  createRunTestWorkspace,
  type RunTestWorkspace,
} from "../support/fixtures/run-workspace.js";

const runSandboxedAgentMock = jest.mocked(harness.runSandboxedAgent);
const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

jest.mock("../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock("../../src/competition/command-adapter.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/competition/command-adapter.js")
  >("../../src/competition/command-adapter.js");
  return {
    ...actual,
    executeCompetitionWithAdapter: jest.fn(
      actual.executeCompetitionWithAdapter,
    ),
  };
});

describe("voratiq spec command options", () => {
  it("requires --description", async () => {
    const specCommand = silenceCommander(createSpecCommand());
    specCommand.exitOverride().action(() => {});

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(specCommand);

    await expect(
      program.parseAsync(["node", "voratiq", "spec"]),
    ).rejects.toThrow(/required option '--description <text>'/iu);
  });

  it("allows omitting --agent", async () => {
    let received: unknown;
    const specCommand = silenceCommander(createSpecCommand());
    specCommand.exitOverride().action((options) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(specCommand);

    await program.parseAsync([
      "node",
      "voratiq",
      "spec",
      "--description",
      "Generate a spec",
    ]);

    expect((received as { description?: string }).description).toBe(
      "Generate a spec",
    );
    expect((received as { agent?: string }).agent).toBeUndefined();
  });

  it("parses --agent when provided", async () => {
    let received: unknown;
    const specCommand = silenceCommander(createSpecCommand());
    specCommand.exitOverride().action((options) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(specCommand);

    await program.parseAsync([
      "node",
      "voratiq",
      "spec",
      "--description",
      "Generate a spec",
      "--agent",
      "reviewer",
    ]);

    expect((received as { agent?: string }).agent).toBe("reviewer");
  });
});

describe("voratiq spec (CLI)", () => {
  let repoRoot: string;
  let originalCwd: string;
  let workspace: RunTestWorkspace;
  let restorePlatformSpy: jest.SpyInstance | undefined;
  let restoreDependenciesSpy: jest.SpyInstance | undefined;

  beforeEach(async () => {
    workspace = await createRunTestWorkspace();
    repoRoot = workspace.root;
    originalCwd = process.cwd();
    process.chdir(repoRoot);
    await createWorkspace(repoRoot);
    await workspace.writeAgentsConfig([
      {
        id: "claude-haiku-4-5-20251001",
        model: "claude-haiku-4-5-20251001",
        binary: workspace.srtStubPath,
        provider: "claude",
        enabled: true,
      },
    ]);

    restorePlatformSpy = jest
      .spyOn(sandboxRuntime, "checkPlatformSupport")
      .mockImplementation(() => {});
    restoreDependenciesSpy = jest
      .spyOn(preflight, "ensureSandboxDependencies")
      .mockImplementation(() => {});

    executeCompetitionWithAdapterMock.mockClear();
    runSandboxedAgentMock.mockReset();
    runSandboxedAgentMock.mockImplementation(async (options) => {
      const draftPath = join(options.paths.workspacePath, "spec.md");
      await mkdir(dirname(draftPath), { recursive: true });
      await writeFile(draftPath, "# Payment Flow\n\nDetails.\n", "utf8");
      return {
        exitCode: 0,
        sandboxSettings: {
          network: {
            allowedDomains: [],
            deniedDomains: [],
          },
          filesystem: {
            denyRead: [],
            allowWrite: [],
            denyWrite: [],
          },
        },
        manifestEnv: {},
      };
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    restorePlatformSpy?.mockRestore();
    restoreDependenciesSpy?.mockRestore();
    await workspace?.cleanup();
  });

  it("runs in non-interactive shells without --yes", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    try {
      const result = await runSpecCommand({
        description: "Write a spec",
        agent: "claude-haiku-4-5-20251001",
      });
      expect(result).toMatchObject({
        outputPath: ".voratiq/specs/payment-flow.md",
      });
      expect(result.body).toContain(
        "Spec saved: .voratiq/specs/payment-flow.md",
      );
      expect(result.body).toContain(
        "To begin a run:\n  voratiq run --spec .voratiq/specs/payment-flow.md",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
      }
    }
  });

  it("resolves spec agent from orchestration when --agent is omitted", async () => {
    await writeOrchestrationConfig(repoRoot, {
      specAgentIds: ["claude-haiku-4-5-20251001"],
    });

    const result = await runSpecCommand({
      description: "Write a spec",
    });

    expect(result).toMatchObject({
      outputPath: ".voratiq/specs/payment-flow.md",
    });
    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [
          expect.objectContaining({ id: "claude-haiku-4-5-20251001" }),
        ],
      }),
    );
  });

  it("uses --agent override instead of orchestration spec defaults", async () => {
    await workspace.writeAgentsConfig([
      {
        id: "claude-haiku-4-5-20251001",
        model: "claude-haiku-4-5-20251001",
        binary: workspace.srtStubPath,
        provider: "claude",
        enabled: true,
      },
      {
        id: "codex-reviewer",
        model: "gpt-5-2-codex",
        binary: workspace.srtStubPath,
        provider: "codex",
        enabled: true,
      },
    ]);
    await writeOrchestrationConfig(repoRoot, {
      specAgentIds: ["codex-reviewer", "claude-haiku-4-5-20251001"],
    });

    const result = await runSpecCommand({
      description: "Write a spec",
      agent: "claude-haiku-4-5-20251001",
    });

    expect(result).toMatchObject({
      outputPath: ".voratiq/specs/payment-flow.md",
    });
    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [
          expect.objectContaining({ id: "claude-haiku-4-5-20251001" }),
        ],
      }),
    );
  });

  it("fails without --agent when orchestration spec agents are empty", async () => {
    await writeOrchestrationConfig(repoRoot, {
      specAgentIds: [],
    });

    let captured: unknown;
    await expect(
      runSpecCommand({
        description: "Write a spec",
      }).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeDefined();

    const rendered = renderCliError(captured as CliError).replace(
      ANSI_PATTERN,
      "",
    );
    expect(rendered).toContain('Error: No agent resolved for stage "spec".');
    expect(rendered).toContain("Provide --agent <id>");
    expect(rendered).toContain("profiles.default.spec.agents");
    expect(rendered).toContain(".voratiq/orchestration.yaml");
    expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
  });

  it("fails without --agent when orchestration spec agents contain multiple ids", async () => {
    await workspace.writeAgentsConfig([
      {
        id: "claude-haiku-4-5-20251001",
        model: "claude-haiku-4-5-20251001",
        binary: workspace.srtStubPath,
        provider: "claude",
        enabled: true,
      },
      {
        id: "codex-reviewer",
        model: "gpt-5-2-codex",
        binary: workspace.srtStubPath,
        provider: "codex",
        enabled: true,
      },
    ]);
    await writeOrchestrationConfig(repoRoot, {
      specAgentIds: ["claude-haiku-4-5-20251001", "codex-reviewer"],
    });

    let captured: unknown;
    await expect(
      runSpecCommand({
        description: "Write a spec",
      }).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeDefined();

    const rendered = renderCliError(captured as CliError).replace(
      ANSI_PATTERN,
      "",
    );
    expect(rendered).toContain(
      'Error: Multiple agents resolved for stage "spec".',
    );
    expect(rendered).toContain("Multi-agent spec is not supported.");
    expect(rendered).toContain(
      "Configure exactly one agent in `.voratiq/orchestration.yaml`.",
    );
    expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
  });

  it("records failed sessions with finalized error metadata", async () => {
    runSandboxedAgentMock.mockResolvedValueOnce({
      exitCode: 1,
      errorMessage: "agent crashed",
      sandboxSettings: {
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      },
      manifestEnv: {},
    });

    await expect(
      runSpecCommand({
        description: "Design a payment flow",
        agent: "claude-haiku-4-5-20251001",
        title: "Payment Flow",
      }),
    ).rejects.toBeDefined();

    const indexPath = join(repoRoot, ".voratiq", "specs", "index.json");
    const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
      sessions: Array<{ sessionId: string; status: string }>;
    };
    const latest = indexPayload.sessions.at(-1);
    expect(latest).toBeDefined();
    expect(latest?.status).toBe("failed");

    const sessionId = latest?.sessionId ?? "";
    const recordPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "record.json",
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      status: string;
      error: string | null;
      outputPath: string;
      completedAt?: string;
    };
    expect(record.status).toBe("failed");
    expect(record.error).toContain("agent crashed");
    expect(record.outputPath).toBe(".voratiq/specs/payment-flow.md");
    expect(record.completedAt).toEqual(expect.any(String));

    const workspacePath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "claude-haiku-4-5-20251001",
      "workspace",
    );
    await expect(readFile(workspacePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("surfaces generation failures with actionable detail", async () => {
    runSandboxedAgentMock.mockResolvedValueOnce({
      exitCode: 1,
      errorMessage: "agent crashed",
      sandboxSettings: {
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      },
      manifestEnv: {},
    });

    let captured: unknown;
    await expect(
      runSpecCommand({
        description: "Write a spec",
        agent: "claude-haiku-4-5-20251001",
      }).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeDefined();

    const rendered = renderCliError(captured as CliError).replace(
      ANSI_PATTERN,
      "",
    );
    expect(rendered).toContain("Error: Specification generation failed.");
    expect(rendered).toContain("agent crashed");
  });

  it("formats invalid agent errors with the desired copy", async () => {
    let captured: unknown;
    await expect(
      runSpecCommand({
        description: "Do something",
        agent: "missing",
      }).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeDefined();

    const rendered = renderCliError(captured as CliError).replace(
      ANSI_PATTERN,
      "",
    );
    expect(rendered).toBe(
      [
        'Error: Agent "missing" not found in agents.yaml.',
        "",
        "To add this agent, edit `.voratiq/agents.yaml`.",
      ].join("\n"),
    );
  });

  it("rejects output paths outside .voratiq/specs", async () => {
    await expect(
      runSpecCommand({
        description: "Spec with bad path",
        agent: "claude-haiku-4-5-20251001",
        output: "../escape.md",
      }),
    ).rejects.toThrow(".voratiq/specs");
  });

  it("aborts when the target output already exists", async () => {
    const existingPath = join(repoRoot, ".voratiq", "specs", "custom.md");
    await mkdir(dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "existing", "utf8");

    await expect(
      runSpecCommand({
        description: "Design a payment flow",
        agent: "claude-haiku-4-5-20251001",
        title: "Payment Flow",
        output: ".voratiq/specs/custom.md",
      }),
    ).rejects.toThrow("File already exists");
  });

  it("surfaces write failures when saving the final spec", async () => {
    const oversizedFilename = `${"x".repeat(300)}.md`;

    let captured: unknown;
    await expect(
      runSpecCommand({
        description: "Design a payment flow",
        agent: "claude-haiku-4-5-20251001",
        title: "Payment Flow",
        output: `.voratiq/specs/${oversizedFilename}`,
      }).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeDefined();

    const rendered = renderCliError(captured as CliError).replace(
      ANSI_PATTERN,
      "",
    );
    expect(rendered).toContain("Error: Specification generation failed.");
    expect(rendered).toMatch(
      /name too long|enametoolong|permission denied|eacces|eperm/i,
    );
  });

  it("promotes spec artifacts, updates records, and writes canonical output", async () => {
    const title = "Payment Flow";

    const result = await runSpecCommand({
      description: "Design a payment flow",
      agent: "claude-haiku-4-5-20251001",
      title,
    });
    expect(runSandboxedAgentMock).toHaveBeenCalledTimes(1);
    expect(result.body).toContain("Spec saved: .voratiq/specs/payment-flow.md");
    expect(result.body).toContain(
      "To begin a run:\n  voratiq run --spec .voratiq/specs/payment-flow.md",
    );

    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledTimes(1);
    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [
          expect.objectContaining({ id: "claude-haiku-4-5-20251001" }),
        ],
      }),
    );

    const indexPath = join(repoRoot, ".voratiq", "specs", "index.json");
    const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
      sessions: Array<{ sessionId: string; status: string }>;
    };
    const latest = indexPayload.sessions.at(-1);
    expect(latest).toBeDefined();
    const sessionId = latest?.sessionId ?? "";
    expect(latest?.status).toBe("saved");

    const recordPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "record.json",
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      slug: string;
      outputPath: string;
      iterations?: unknown;
      agentId: string;
    };

    expect(record.slug).toBe("payment-flow");
    expect(record.outputPath).toBe(".voratiq/specs/payment-flow.md");
    expect(record.agentId).toBe("claude-haiku-4-5-20251001");
    expect(record.iterations).toBeUndefined();

    const artifactPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "claude-haiku-4-5-20251001",
      "artifacts",
      "spec.md",
    );
    const canonicalPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "payment-flow.md",
    );

    await expect(readFile(artifactPath, "utf8")).resolves.toContain(
      "# Payment Flow",
    );
    await expect(readFile(canonicalPath, "utf8")).resolves.toContain(
      "# Payment Flow",
    );

    const workspacePath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "claude-haiku-4-5-20251001",
      "workspace",
    );
    await expect(readFile(workspacePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function writeOrchestrationConfig(
  root: string,
  options: {
    runAgentIds?: readonly string[];
    reviewAgentIds?: readonly string[];
    specAgentIds?: readonly string[];
  } = {},
): Promise<void> {
  const runAgentIds = options.runAgentIds ?? [];
  const reviewAgentIds = options.reviewAgentIds ?? [];
  const specAgentIds = options.specAgentIds ?? [];

  const lines = ["profiles:", "  default:"];
  appendStage(lines, "run", runAgentIds);
  appendStage(lines, "review", reviewAgentIds);
  appendStage(lines, "spec", specAgentIds);
  lines.push("");

  await writeFile(
    join(root, ".voratiq", "orchestration.yaml"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

function appendStage(
  lines: string[],
  stageId: "run" | "review" | "spec",
  agentIds: readonly string[],
): void {
  lines.push(`    ${stageId}:`);
  if (agentIds.length === 0) {
    lines.push("      agents: []");
    return;
  }

  lines.push("      agents:");
  for (const agentId of agentIds) {
    lines.push(`        - id: ${JSON.stringify(agentId)}`);
  }
}
