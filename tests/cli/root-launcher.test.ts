import { describe, expect, it, jest } from "@jest/globals";

import type { ConfirmationWorkflow } from "../../src/cli/confirmation.js";
import type { CommandOutputPayload } from "../../src/cli/output.js";
import {
  runInteractiveRootLauncher,
  shouldStartRootLauncher,
} from "../../src/cli/root-launcher.js";
import type { AgentCatalogDiagnostics } from "../../src/configs/agents/loader.js";
import type {
  AgentConfigEntry,
  AgentDefinition,
} from "../../src/configs/agents/types.js";
import type {
  InteractiveSessionRecord,
  PreparedInteractiveSession,
} from "../../src/interactive/index.js";
import { colorize } from "../../src/utils/colors.js";

describe("root interactive launcher", () => {
  it("starts only for bare root invocation in an interactive shell", () => {
    expect(shouldStartRootLauncher(["node", "voratiq"], () => true)).toBe(true);
    expect(shouldStartRootLauncher(["node", "voratiq"], () => false)).toBe(
      false,
    );
    expect(
      shouldStartRootLauncher(["node", "voratiq", "--help"], () => true),
    ).toBe(false);
    expect(
      shouldStartRootLauncher(["node", "voratiq", "run"], () => true),
    ).toBe(false);
  });

  it("skips selection when exactly one enabled agent is launchable", async () => {
    const prompt = jest.fn<ConfirmationWorkflow["prompt"]>(() =>
      Promise.resolve(""),
    );
    const close = jest.fn();
    const output = captureLauncherOutput();
    const selfCliTarget = {
      command: "node",
      argsPrefix: ["/repo/dist/bin.js"],
    };
    const preparedSession = buildPreparedInteractiveSession();
    let preparedWith: unknown;
    const prepareSession = (options: unknown) => {
      preparedWith = options;
      return Promise.resolve({ ok: true as const, prepared: preparedSession });
    };
    let spawnedWith: [unknown, unknown] | undefined;
    const spawnSession = (prepared: unknown, options: unknown) => {
      spawnedWith = [prepared, options];
      return Promise.resolve(buildSuccessfulLaunchResult("succeeded"));
    };

    await runInteractiveRootLauncher({
      resolveContext: resolveCliContextMock("/repo"),
      loadDiagnostics: () =>
        buildDiagnostics({
          enabledAgents: [
            buildAgentEntry("codex-main"),
            buildAgentEntry("claude-blocked", {
              provider: "claude",
              model: "claude-opus-4-6",
            }),
          ],
          catalog: [buildAgentDefinition("codex-main")],
          issues: [
            {
              agentId: "claude-blocked",
              message:
                "binary `/usr/local/bin/claude` is not executable (ENOENT)",
            },
          ],
        }),
      createWorkflow: () => ({
        interactive: true,
        confirm: () => Promise.resolve(true),
        prompt,
        close,
      }),
      prepareSession,
      spawnSession,
      selfCliTarget,
      writeOutput: output.writeOutput,
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(preparedWith).toEqual(
      expect.objectContaining({
        root: "/repo",
        cwd: "/repo",
        agentId: "codex-main",
        launchMode: "first-party",
        voratiqCliTarget: selfCliTarget,
        promptForMcpInstall: expect.any(Function),
      }),
    );
    expect(spawnedWith).toEqual([preparedSession, { stdio: "inherit" }]);
    expect(close).toHaveBeenCalledTimes(1);

    expect(output.text()).toContain(
      "Start a native agent session from this repository.",
    );
    expect(output.text()).toContain(
      "Using agent: codex-main (codex / gpt-5.4)",
    );
    expect(output.text()).toContain(
      "Launching codex-main (codex / gpt-5.4)...",
    );
  });

  it("requires an explicit numeric choice when multiple agents are launchable", async () => {
    const prompt = jest
      .fn<ConfirmationWorkflow["prompt"]>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("2");
    const output = captureLauncherOutput();
    const selfCliTarget = {
      command: "node",
      argsPrefix: ["/repo/dist/bin.js"],
    };
    const preparedSession = buildPreparedInteractiveSession();
    let preparedWith: unknown;
    const prepareSession = (options: unknown) => {
      preparedWith = options;
      return Promise.resolve({ ok: true as const, prepared: preparedSession });
    };
    let spawnedWith: [unknown, unknown] | undefined;
    const spawnSession = (prepared: unknown, options: unknown) => {
      spawnedWith = [prepared, options];
      return Promise.resolve(buildSuccessfulLaunchResult("succeeded"));
    };

    await runInteractiveRootLauncher({
      resolveContext: resolveCliContextMock("/repo"),
      loadDiagnostics: () =>
        buildDiagnostics({
          enabledAgents: [
            buildAgentEntry("codex-main"),
            buildAgentEntry("claude-main", {
              provider: "claude",
              model: "claude-opus-4-6",
            }),
          ],
          catalog: [
            buildAgentDefinition("codex-main"),
            buildAgentDefinition("claude-main", {
              provider: "claude",
              model: "claude-opus-4-6",
              binary: "/usr/local/bin/claude",
              argv: ["--model", "claude-opus-4-6"],
            }),
          ],
        }),
      createWorkflow: () => ({
        interactive: true,
        confirm: () => Promise.resolve(true),
        prompt,
        close: jest.fn(),
      }),
      prepareSession,
      spawnSession,
      selfCliTarget,
      writeOutput: output.writeOutput,
    });

    expect(prompt).toHaveBeenNthCalledWith(1, {
      message: "[1-2]",
      prefaceLines: undefined,
    });
    expect(prompt).toHaveBeenNthCalledWith(2, {
      message: "[1-2]",
      prefaceLines: undefined,
    });
    expect(output.text()).toContain("Choose a number from 1 to 2.");
    expect(output.text()).not.toContain(
      "Selected agent: claude-main (claude / claude-opus-4-6)",
    );
    expect(preparedWith).toEqual(
      expect.objectContaining({
        root: "/repo",
        cwd: "/repo",
        agentId: "claude-main",
        launchMode: "first-party",
        voratiqCliTarget: selfCliTarget,
        promptForMcpInstall: expect.any(Function),
      }),
    );
    expect(spawnedWith).toEqual([preparedSession, { stdio: "inherit" }]);
  });

  it("keeps confirmation workflow open for MCP prompts and closes before spawning", async () => {
    let closed = false;
    const close = jest.fn(() => {
      closed = true;
    });
    const confirm = jest.fn<ConfirmationWorkflow["confirm"]>(() => {
      if (closed) {
        throw new Error("readline was closed");
      }
      return Promise.resolve(true);
    });

    await runInteractiveRootLauncher({
      resolveContext: resolveCliContextMock("/repo"),
      loadDiagnostics: () =>
        buildDiagnostics({
          enabledAgents: [buildAgentEntry("codex-main")],
          catalog: [buildAgentDefinition("codex-main")],
        }),
      createWorkflow: () => ({
        interactive: true,
        confirm,
        prompt: () => Promise.resolve(""),
        close,
      }),
      prepareSession: async (options) => {
        await options.promptForMcpInstall?.({
          providerId: "codex",
          message: "Would you like to install the Voratiq MCP?",
          defaultValue: true,
        });
        return {
          ok: true as const,
          prepared: buildPreparedInteractiveSession(),
        };
      },
      spawnSession: () => {
        if (!closed) {
          throw new Error("readline was not closed");
        }
        return Promise.resolve(buildSuccessfulLaunchResult("succeeded"));
      },
      writeOutput: () => {},
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      message: "Would you like to install the Voratiq MCP?",
      defaultValue: true,
      prefaceLines: [""],
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(closed).toBe(true);
  });

  it("prints success after an accepted MCP install before launching", async () => {
    const output = captureLauncherOutput();

    await runInteractiveRootLauncher({
      resolveContext: resolveCliContextMock("/repo"),
      loadDiagnostics: () =>
        buildDiagnostics({
          enabledAgents: [buildAgentEntry("codex-main")],
          catalog: [buildAgentDefinition("codex-main")],
        }),
      createWorkflow: () => ({
        interactive: true,
        confirm: () => Promise.resolve(true),
        prompt: () => Promise.resolve(""),
        close: jest.fn(),
      }),
      prepareSession: async (options) => {
        await options.promptForMcpInstall?.({
          providerId: "codex",
          message: "Would you like to install the Voratiq MCP?",
          defaultValue: true,
        });
        return {
          ok: true as const,
          prepared: buildPreparedInteractiveSession(),
        };
      },
      spawnSession: () =>
        Promise.resolve(buildSuccessfulLaunchResult("succeeded")),
      writeOutput: output.writeOutput,
    });

    expect(output.text()).toContain("Installing Voratiq MCP...");
    expect(output.text()).toContain(colorize("Success!", "green"));
    expect(output.text()).toContain(
      "Launching codex-main (codex / gpt-5.4)...",
    );
    expect(output.payloads()[1]).toMatchObject({
      alerts: [{ severity: "info", message: "Installing Voratiq MCP..." }],
      leadingNewline: false,
    });
    expect(output.payloads()[2]).toMatchObject({
      alerts: [{ severity: "info", message: colorize("Success!", "green") }],
      leadingNewline: false,
    });
    expect(output.payloads()[3]).toMatchObject({
      alerts: [
        {
          severity: "info",
          message: "Launching codex-main (codex / gpt-5.4)...",
        },
      ],
      leadingNewline: true,
    });
  });

  it("surfaces enabled agents that are unavailable and refuses launch when none are launchable", async () => {
    await expect(
      runInteractiveRootLauncher({
        resolveContext: resolveCliContextMock("/repo"),
        loadDiagnostics: () =>
          buildDiagnostics({
            enabledAgents: [
              buildAgentEntry("codex-main"),
              buildAgentEntry("claude-main", {
                provider: "claude",
                model: "claude-opus-4-6",
              }),
            ],
            catalog: [],
            issues: [
              { agentId: "codex-main", message: "missing binary path" },
              {
                agentId: "claude-main",
                message:
                  "binary `/usr/local/bin/claude` is not executable (EACCES)",
              },
            ],
          }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        headline: "No enabled agents can be launched.",
        detailLines: [
          "Enabled agents with blocking issues:",
          "  - codex-main (codex / gpt-5.4): missing binary path",
          "  - claude-main (claude / claude-opus-4-6): binary `/usr/local/bin/claude` is not executable (EACCES)",
        ],
      }),
    );
  });

  it("auto-initializes the workspace when bare voratiq is used in a fresh repo", async () => {
    const resolveContext = resolveCliContextMock("/repo", true);
    const output = captureLauncherOutput();

    await runInteractiveRootLauncher({
      resolveContext,
      loadDiagnostics: () =>
        buildDiagnostics({
          enabledAgents: [buildAgentEntry("codex-main")],
          catalog: [buildAgentDefinition("codex-main")],
        }),
      createWorkflow: () => ({
        interactive: true,
        confirm: () => Promise.resolve(true),
        prompt: () => Promise.resolve(""),
        close: jest.fn(),
      }),
      prepareSession: () =>
        Promise.resolve({
          ok: true as const,
          prepared: buildPreparedInteractiveSession(),
        }),
      spawnSession: () =>
        Promise.resolve(buildSuccessfulLaunchResult("succeeded")),
      writeOutput: output.writeOutput,
    });

    expect(resolveContext.mock.calls[0]?.[0]).toEqual({
      requireWorkspace: true,
      workspaceAutoInitMode: "when-missing",
    });
    expect(output.text()).toContain("Voratiq initialized (.voratiq/).");
  });

  it("uses a launcher-specific interactive-shell error contract", async () => {
    await expect(
      runInteractiveRootLauncher({
        resolveContext: resolveCliContextMock("/repo"),
        loadDiagnostics: () =>
          buildDiagnostics({
            enabledAgents: [buildAgentEntry("codex-main")],
            catalog: [buildAgentDefinition("codex-main")],
          }),
        createWorkflow: ({ onUnavailable }) => onUnavailable(),
        writeOutput: () => {},
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        headline:
          "An interactive terminal is required to launch a native agent session.",
        hintLines: [
          "Run `voratiq` from an interactive terminal, or use an explicit subcommand instead.",
        ],
      }),
    );
  });
});

function buildCliContext(root: string, workspaceAutoInitialized = false) {
  return {
    root,
    workspaceAutoInitialized,
    workspacePaths: {
      root,
      workspaceDir: `${root}/.voratiq`,
      runsDir: `${root}/.voratiq/run/sessions`,
      runsFile: `${root}/.voratiq/run/index.json`,
      reductionsDir: `${root}/.voratiq/reduce/sessions`,
      reductionsFile: `${root}/.voratiq/reduce/index.json`,
      specsDir: `${root}/.voratiq/spec/sessions`,
      specsFile: `${root}/.voratiq/spec/index.json`,
      verificationsDir: `${root}/.voratiq/verify/sessions`,
      verificationsFile: `${root}/.voratiq/verify/index.json`,
    },
  };
}

function resolveCliContextMock(root: string, workspaceAutoInitialized = false) {
  return jest.fn((...args: [unknown?]) => {
    void args;
    return Promise.resolve(buildCliContext(root, workspaceAutoInitialized));
  });
}

function captureLauncherOutput() {
  const payloads: CommandOutputPayload[] = [];
  return {
    writeOutput: (payload: CommandOutputPayload) => {
      payloads.push(payload);
    },
    payloads(): readonly CommandOutputPayload[] {
      return payloads;
    },
    text(): string {
      return payloads
        .flatMap((payload) => {
          const alertLines = (payload.alerts ?? []).map(
            (alert) => alert.message,
          );
          const body =
            typeof payload.body === "string"
              ? [payload.body]
              : (payload.body ?? []);
          return [...alertLines, ...body];
        })
        .join("\n");
    },
  };
}

function buildDiagnostics(input: {
  enabledAgents: AgentConfigEntry[];
  catalog: AgentDefinition[];
  issues?: Array<{ agentId: string; message: string }>;
}): AgentCatalogDiagnostics {
  return {
    enabledAgents: input.enabledAgents,
    catalog: input.catalog,
    issues: input.issues ?? [],
  };
}

function buildAgentEntry(
  id: string,
  overrides: Partial<AgentConfigEntry> = {},
): AgentConfigEntry {
  return {
    id,
    provider: "codex",
    model: "gpt-5.4",
    enabled: true,
    binary: "/usr/local/bin/codex",
    ...overrides,
  };
}

function buildAgentDefinition(
  id: string,
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id,
    provider: "codex",
    model: "gpt-5.4",
    binary: "/usr/local/bin/codex",
    argv: ["--model", "gpt-5.4"],
    ...overrides,
  };
}

function buildSuccessfulLaunchResult(
  status: InteractiveSessionRecord["status"],
) {
  return {
    ok: true as const,
    prepared: {} as never,
    process: {} as never,
    pid: 123,
    completion: Promise.resolve({
      sessionId: "session-1",
      createdAt: new Date().toISOString(),
      status,
      agentId: "agent",
      toolAttachmentStatus: "not-requested",
    } as InteractiveSessionRecord),
  };
}

function buildPreparedInteractiveSession(): PreparedInteractiveSession {
  return {
    sessionId: "session-1",
    createdAt: new Date().toISOString(),
    root: "/repo",
    agent: buildAgentDefinition("agent"),
    providerId: "codex",
    sessionRoot: "/repo/.voratiq/interactive/sessions/session-1",
    runtimePath: "/repo/.voratiq/interactive/sessions/session-1/runtime",
    artifactsPath: "/repo/.voratiq/interactive/sessions/session-1/artifacts",
    recordPath: "/repo/.voratiq/interactive/sessions/session-1/record.json",
    indexPath: "/repo/.voratiq/interactive/index.json",
    toolAttachmentStatus: "attached",
    invocation: {
      command: "/usr/local/bin/codex",
      args: ["--model", "gpt-5.4"],
      env: process.env,
      cwd: "/repo",
    },
    artifactCaptureSupported: true,
  };
}
