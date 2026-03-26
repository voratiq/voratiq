import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Command } from "commander";

import * as harness from "../../src/agents/runtime/harness.js";
import * as sandboxRuntime from "../../src/agents/runtime/sandbox.js";
import { CliError } from "../../src/cli/errors.js";
import { createSpecCommand, runSpecCommand } from "../../src/cli/spec.js";
import { executeCompetitionWithAdapter } from "../../src/competition/command-adapter.js";
import { readAgentsConfig } from "../../src/configs/agents/loader.js";
import { readSpecRecords } from "../../src/domain/spec/persistence/adapter.js";
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
    expect((received as { agent?: string[] }).agent).toEqual([]);
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

    expect((received as { agent?: string[] }).agent).toEqual(["reviewer"]);
  });

  it("parses --profile when provided", async () => {
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
      "--profile",
      "quality",
    ]);

    expect((received as { profile?: string }).profile).toBe("quality");
  });

  it("parses --max-parallel when provided", async () => {
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
      "--max-parallel",
      "2",
    ]);

    expect((received as { maxParallel?: number }).maxParallel).toBe(2);
  });

  it("parses repeatable --extra-context preserving order", async () => {
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
      "--extra-context",
      "notes/a.md",
      "--extra-context",
      "notes/b.json",
    ]);

    expect((received as { extraContext?: string[] }).extraContext).toEqual([
      "notes/a.md",
      "notes/b.json",
    ]);
  });

  it("does not expose auto-init toggles in help output", () => {
    const help = createSpecCommand().helpInformation();
    expect(help).not.toContain("--auto-init");
    expect(help).not.toContain("--no-auto-init");
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
      const dataPath = join(options.paths.workspacePath, "spec.json");
      await mkdir(dirname(draftPath), { recursive: true });
      await writeFile(draftPath, "# Payment Flow\n\nDetails.\n", "utf8");
      await writeFile(
        dataPath,
        JSON.stringify(
          {
            title: "Payment Flow",
            objective: "Define the payment flow outcome clearly.",
            scope: ["Describe the payment flow draft."],
            acceptanceCriteria: ["Capture the payment flow."],
            constraints: ["Keep the draft concise and repo-grounded."],
            exitSignal: "The payment flow spec is ready to feed run.",
          },
          null,
          2,
        ),
        "utf8",
      );
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

  it("auto-initializes a missing workspace and emits a single notice", async () => {
    await rm(join(repoRoot, ".voratiq"), { recursive: true, force: true });

    const providerBinDir = join(repoRoot, "provider-bin");
    await mkdir(providerBinDir, { recursive: true });
    const codexPath = join(providerBinDir, "codex");
    await writeFile(codexPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(codexPath, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${providerBinDir}:${originalPath ?? ""}`;
    const infoMessages: string[] = [];

    try {
      const result = await runSpecCommand({
        description: "Write a spec",
        agentIds: ["gpt-5-3-codex"],
        writeOutput: (payload) => {
          for (const alert of payload.alerts ?? []) {
            if (alert.severity === "info") {
              infoMessages.push(alert.message);
            }
          }
        },
      });

      expect(result.specPath).toBeDefined();
      expect(result.generatedSpecPaths).toHaveLength(1);
      expect(
        infoMessages.filter(
          (message) => message === "Voratiq initialized (.voratiq/).",
        ),
      ).toHaveLength(1);

      const agents = readAgentsConfig(
        await readFile(join(repoRoot, ".voratiq", "agents.yaml"), "utf8"),
      );
      const codexEntries = agents.agents.filter(
        (entry) => entry.provider === "codex",
      );
      expect(codexEntries.length).toBeGreaterThan(0);
      for (const entry of codexEntries) {
        expect(entry.binary).toBe(codexPath);
      }
    } finally {
      process.env.PATH = originalPath;
    }
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
        agentIds: ["claude-haiku-4-5-20251001"],
      });
      expect(result.specPath).toBeDefined();
      expect(result.generatedSpecPaths).toHaveLength(1);
      expect(result.body).toContain("SUCCEEDED");
      expect(result.body).toContain("claude-haiku-4-5-20251001");
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

    expect(result.specPath).toBeDefined();
    expect(result.generatedSpecPaths).toHaveLength(1);
    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [
          expect.objectContaining({ id: "claude-haiku-4-5-20251001" }),
        ],
      }),
    );
  });

  it("resolves spec agent from selected profile when --profile is provided", async () => {
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
      profiles: {
        default: {
          runAgentIds: [],
          reviewAgentIds: [],
          specAgentIds: ["claude-haiku-4-5-20251001"],
        },
        quality: {
          runAgentIds: [],
          reviewAgentIds: [],
          specAgentIds: ["codex-reviewer"],
        },
      },
    });

    const result = await runSpecCommand({
      description: "Write a spec",
      profile: "quality",
    });

    expect(result.specPath).toBeDefined();
    expect(result.generatedSpecPaths).toHaveLength(1);
    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [expect.objectContaining({ id: "codex-reviewer" })],
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
      profiles: {
        default: {
          runAgentIds: [],
          reviewAgentIds: [],
          specAgentIds: ["codex-reviewer", "claude-haiku-4-5-20251001"],
        },
        quality: {
          runAgentIds: [],
          reviewAgentIds: [],
          specAgentIds: ["codex-reviewer"],
        },
      },
    });

    const result = await runSpecCommand({
      description: "Write a spec",
      agentIds: ["claude-haiku-4-5-20251001"],
      profile: "quality",
    });

    expect(result.specPath).toBeDefined();
    expect(result.generatedSpecPaths).toHaveLength(1);
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
    expect(rendered).toContain("Error: No agents configured for stage `spec`.");
    expect(rendered).toContain(
      "Checked `profiles.default.spec.agents` in `orchestration.yaml`.",
    );
    expect(rendered).toContain(
      "Configure at least one agent under `profiles.default.spec.agents` in `orchestration.yaml`.",
    );
    expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
  });

  it("runs all agents when orchestration spec agents contain multiple ids", async () => {
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

    const result = await runSpecCommand({
      description: "Write a spec",
    });

    expect(result.specPath).toBeUndefined();
    expect(result.generatedSpecPaths).toHaveLength(2);
    const firstCall = executeCompetitionWithAdapterMock.mock.calls[0]?.[0] as
      | { maxParallel: number; candidates: ReadonlyArray<{ id: string }> }
      | undefined;
    expect(firstCall?.maxParallel).toBe(2);
    expect(firstCall?.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(["claude-haiku-4-5-20251001", "codex-reviewer"]),
    );
  });

  it("persists distinct per-agent lifecycle timestamps during multi-agent generation", async () => {
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

    let invocationCount = 0;

    runSandboxedAgentMock.mockImplementation(async (options) => {
      invocationCount += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, invocationCount * 15);
      });

      await writeFile(
        join(options.paths.workspacePath, "spec.md"),
        `# ${options.agent.id}\n\nDetails.\n`,
        "utf8",
      );
      await writeFile(
        join(options.paths.workspacePath, "spec.json"),
        JSON.stringify(
          {
            title: options.agent.id,
            objective: "Define the draft outcome clearly.",
            scope: ["Capture the candidate draft."],
            acceptanceCriteria: ["Capture the draft."],
            constraints: ["Keep the draft concise."],
            exitSignal: "The draft is ready for downstream use.",
          },
          null,
          2,
        ),
        "utf8",
      );

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

    const result = await runSpecCommand({
      description: "Write a spec",
      agentIds: ["claude-haiku-4-5-20251001", "codex-reviewer"],
      maxParallel: 1,
    });

    expect(result.sessionId).toBeDefined();
    const finalRecord = (
      await readSpecRecords({
        root: repoRoot,
        specsFilePath: join(repoRoot, ".voratiq", "spec", "index.json"),
        limit: 1,
        predicate: (entry) => entry.sessionId === result.sessionId,
      })
    )[0];
    expect(finalRecord?.agents).toHaveLength(2);
    const [firstAgent, secondAgent] = finalRecord?.agents ?? [];
    expect(firstAgent?.agentId).toBe("claude-haiku-4-5-20251001");
    expect(firstAgent?.status).toBe("succeeded");
    expect(typeof firstAgent?.startedAt).toBe("string");
    expect(typeof firstAgent?.completedAt).toBe("string");
    expect(secondAgent?.agentId).toBe("codex-reviewer");
    expect(secondAgent?.status).toBe("succeeded");
    expect(typeof secondAgent?.startedAt).toBe("string");
    expect(typeof secondAgent?.completedAt).toBe("string");
    expect(Date.parse(firstAgent?.startedAt ?? "")).toBeLessThan(
      Date.parse(secondAgent?.startedAt ?? ""),
    );
    expect(Date.parse(firstAgent?.completedAt ?? "")).toBeLessThanOrEqual(
      Date.parse(secondAgent?.startedAt ?? ""),
    );
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
        agentIds: ["claude-haiku-4-5-20251001"],
        title: "Payment Flow",
      }),
    ).rejects.toBeDefined();

    const indexPath = join(repoRoot, ".voratiq", "spec", "index.json");
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
      "spec",
      "sessions",
      sessionId,
      "record.json",
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      status: string;
      error: string | null;
      agents: Array<{ agentId: string; status: string; error?: string | null }>;
      completedAt?: string;
    };
    expect(record.status).toBe("failed");
    expect(record.error).toContain("agent crashed");
    expect(record.agents[0]?.agentId).toBe("claude-haiku-4-5-20251001");
    expect(record.agents[0]?.status).toBe("failed");
    expect(record.completedAt).toEqual(expect.any(String));

    const workspacePath = join(
      repoRoot,
      ".voratiq",
      "spec",
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
        agentIds: ["claude-haiku-4-5-20251001"],
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
        agentIds: ["missing"],
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
        "Error: Agent `missing` not found in `agents.yaml`.",
        "",
        "Add this agent to `agents.yaml`.",
      ].join("\n"),
    );
  });

  it("promotes spec artifacts and updates session records", async () => {
    const title = "Payment Flow";
    const slug = "payment-flow";

    const result = await runSpecCommand({
      description: "Design a payment flow",
      agentIds: ["claude-haiku-4-5-20251001"],
      title,
    });
    expect(runSandboxedAgentMock).toHaveBeenCalledTimes(1);
    expect(runSandboxedAgentMock.mock.calls[0]?.[0]?.sandboxStageId).toBe(
      "spec",
    );
    expect(result.body).toContain("SUCCEEDED");
    expect(result.body).toContain("claude-haiku-4-5-20251001");

    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledTimes(1);
    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
        candidates: [
          expect.objectContaining({ id: "claude-haiku-4-5-20251001" }),
        ],
      }),
    );

    const indexPath = join(repoRoot, ".voratiq", "spec", "index.json");
    const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
      sessions: Array<{ sessionId: string; status: string }>;
    };
    const latest = indexPayload.sessions.at(-1);
    expect(latest).toBeDefined();
    const sessionId = latest?.sessionId ?? "";
    expect(latest?.status).toBe("succeeded");

    const recordPath = join(
      repoRoot,
      ".voratiq",
      "spec",
      "sessions",
      sessionId,
      "record.json",
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      status: string;
      description: string;
      agents: Array<{
        agentId: string;
        status: string;
        outputPath?: string;
        dataPath?: string;
      }>;
    };

    expect(record.status).toBe("succeeded");
    expect(record.description).toBe("Design a payment flow");
    expect(record.agents).toHaveLength(1);
    expect(record.agents[0]?.agentId).toBe("claude-haiku-4-5-20251001");
    expect(record.agents[0]?.status).toBe("succeeded");
    expect(record.agents[0]?.outputPath).toBeDefined();
    expect(record.agents[0]?.dataPath).toBeDefined();
    expect(record.agents[0]?.outputPath).toBe(
      `.voratiq/spec/sessions/${sessionId}/claude-haiku-4-5-20251001/artifacts/${slug}.md`,
    );
    expect(record.agents[0]?.dataPath).toBe(
      `.voratiq/spec/sessions/${sessionId}/claude-haiku-4-5-20251001/artifacts/${slug}.json`,
    );

    const artifactPath = join(
      repoRoot,
      ".voratiq",
      "spec",
      "sessions",
      sessionId,
      "claude-haiku-4-5-20251001",
      "artifacts",
      `${slug}.md`,
    );

    await expect(readFile(artifactPath, "utf8")).resolves.toContain(
      "# Payment Flow",
    );
    await expect(
      readFile(
        join(
          repoRoot,
          ".voratiq",
          "spec",
          "sessions",
          sessionId,
          "claude-haiku-4-5-20251001",
          "artifacts",
          `${slug}.json`,
        ),
        "utf8",
      ),
    ).resolves.toContain('"title": "Payment Flow"');

    const workspacePath = join(
      repoRoot,
      ".voratiq",
      "spec",
      "sessions",
      sessionId,
      "claude-haiku-4-5-20251001",
      "workspace",
    );
    await expect(readFile(workspacePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("clamps spec max-parallel to competitor count", async () => {
    await runSpecCommand({
      description: "Design a payment flow",
      agentIds: ["claude-haiku-4-5-20251001"],
      maxParallel: 8,
    });

    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 1,
      }),
    );
  });
});

async function writeOrchestrationConfig(
  root: string,
  options: {
    runAgentIds?: readonly string[];
    reviewAgentIds?: readonly string[];
    specAgentIds?: readonly string[];
    reduceAgentIds?: readonly string[];
    profiles?: Record<
      string,
      {
        runAgentIds?: readonly string[];
        reviewAgentIds?: readonly string[];
        specAgentIds?: readonly string[];
        reduceAgentIds?: readonly string[];
      }
    >;
  } = {},
): Promise<void> {
  const profiles =
    options.profiles ??
    ({
      default: {
        runAgentIds: options.runAgentIds ?? [],
        reviewAgentIds: options.reviewAgentIds ?? [],
        specAgentIds: options.specAgentIds ?? [],
        reduceAgentIds: options.reduceAgentIds ?? [],
      },
    } satisfies Record<
      string,
      {
        runAgentIds?: readonly string[];
        reviewAgentIds?: readonly string[];
        specAgentIds?: readonly string[];
        reduceAgentIds?: readonly string[];
      }
    >);

  const lines = ["profiles:"];
  for (const [profileName, profileStages] of Object.entries(profiles)) {
    lines.push(`  ${profileName}:`);
    appendStage(lines, "spec", profileStages.specAgentIds ?? []);
    appendStage(lines, "run", profileStages.runAgentIds ?? []);
    appendStage(lines, "reduce", profileStages.reduceAgentIds ?? []);
    appendStage(lines, "verify", profileStages.reviewAgentIds ?? []);
  }
  lines.push("");

  await writeFile(
    join(root, ".voratiq", "orchestration.yaml"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

function appendStage(
  lines: string[],
  stageId: "spec" | "run" | "reduce" | "verify",
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
