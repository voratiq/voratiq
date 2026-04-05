import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { collectProviderArtifacts } from "../../src/agents/launch/chat.js";
import {
  finalizeActiveInteractive,
  registerActiveInteractive,
} from "../../src/commands/interactive/lifecycle.js";
import { FIRST_PARTY_ATTACHED_LAUNCH_PROMPT } from "../../src/domain/interactive/prompt.js";
import {
  prepareNativeInteractiveSession,
  spawnPreparedInteractiveSession,
} from "../../src/interactive/substrate.js";
import type { ProviderMcpCommandRunner } from "../../src/interactive/types.js";

jest.mock("../../src/agents/launch/chat.js", () => ({
  collectProviderArtifacts: jest.fn(),
}));

jest.mock("../../src/commands/interactive/lifecycle.js", () => ({
  clearActiveInteractive: jest.fn(),
  finalizeActiveInteractive: jest.fn(() => Promise.resolve()),
  registerActiveInteractive: jest.fn(),
}));

const collectProviderArtifactsMock = jest.mocked(collectProviderArtifacts);
const finalizeActiveInteractiveMock = jest.mocked(finalizeActiveInteractive);
const registerActiveInteractiveMock = jest.mocked(registerActiveInteractive);

const tempRoots: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  collectProviderArtifactsMock.mockResolvedValue({ captured: false });
  finalizeActiveInteractiveMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("interactive native launch substrate", () => {
  it("prepares a first-party native codex launch with bundled MCP injection", async () => {
    const fixture = await createWorkspaceFixture();
    const sessionId = "20260401-123456-abcd1";
    const voratiqCliTarget = {
      command: "node",
      argsPrefix: ["/repo/dist/bin.js"],
    };
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          name: "voratiq",
          command: "node",
          args: ["/repo/dist/bin.js", "mcp", "--stdio"],
        }),
        stderr: "",
      }),
    );

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId,
      launchMode: "first-party",
      voratiqCliTarget,
      mcpCommandRunner,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    expect(prepared.prepared.invocation.command).toBe(fixture.binaryPath);
    expect(prepared.prepared.invocation.args).not.toContain("exec");
    expect(prepared.prepared.invocation.args).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(prepared.prepared.invocation.args).toEqual(
      expect.arrayContaining(["--model", "gpt-5.4"]),
    );
    expect(prepared.prepared.toolAttachmentStatus).toBe("attached");
    expect(prepared.prepared.promptPath).toBeDefined();
    await expect(
      readFile(prepared.prepared.promptPath ?? "", "utf8"),
    ).resolves.toBe(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT);
    expect(prepared.prepared.invocation.env.HOME).toBe(process.env.HOME);
    expect(prepared.prepared.invocation.env.CODEX_HOME).toBeUndefined();
    expect(prepared.prepared.invocation.args).not.toContain("--config");

    const record = await readJson(prepared.prepared.recordPath);
    expect(record).toMatchObject({
      sessionId,
      status: "running",
      agentId: "codex-test",
      toolAttachmentStatus: "attached",
    });

    const index = await readJson(prepared.prepared.indexPath);
    expect(index).toMatchObject({
      version: 1,
      sessions: [
        {
          sessionId,
          status: "running",
        },
      ],
    });
  });

  it("uses fallback launch notice when gemini bundled MCP is unavailable", async () => {
    const fixture = await createWorkspaceFixture({ provider: "gemini" });
    const sessionId = "20260401-123457-gemin";
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: "No MCP servers configured.\n",
        stderr: "",
      }),
    );

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "gemini-test",
      sessionId,
      launchMode: "first-party",
      mcpCommandRunner,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    expect(prepared.prepared.toolAttachmentStatus).toBe("failed");
    expect(prepared.prepared.invocation.args).not.toContain(
      FIRST_PARTY_ATTACHED_LAUNCH_PROMPT,
    );
    expect(prepared.prepared.promptPath).toBeUndefined();

    const record = await readJson(prepared.prepared.recordPath);
    expect(record).toMatchObject({
      sessionId,
      status: "running",
      agentId: "gemini-test",
      toolAttachmentStatus: "failed",
    });
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
  });

  it("installs global gemini MCP when launch prompt is accepted", async () => {
    const fixture = await createWorkspaceFixture({ provider: "gemini" });
    const sessionId = "20260401-123458-gemok";
    const installed = new Set<string>();
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "list") {
        return Promise.resolve({
          exitCode: 0,
          stdout:
            installed.size === 0
              ? "No MCP servers configured.\n"
              : "✓ voratiq: node /repo/dist/bin.js mcp --stdio (stdio) - Connected\n",
          stderr: "",
        });
      }
      if (input.args[1] === "add") {
        installed.add(String(input.args[4]));
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server voratiq\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "gemini-test",
      sessionId,
      launchMode: "first-party",
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
      voratiqCliTarget: {
        command: "node",
        argsPrefix: ["/repo/dist/bin.js"],
      },
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    expect(prepared.prepared.toolAttachmentStatus).toBe("attached");
    await expect(
      readFile(prepared.prepared.promptPath ?? "", "utf8"),
    ).resolves.toBe(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT);
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(1, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: fixture.root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(2, {
      command: "gemini",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "--trust",
        "voratiq",
        "node",
        "/repo/dist/bin.js",
        "mcp",
        "--stdio",
      ],
      cwd: fixture.root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(3, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: fixture.root,
    });
  });

  it("skips gemini MCP prompt when settings preference is never", async () => {
    const fixture = await createWorkspaceFixture({ provider: "gemini" });
    await writeFile(
      join(fixture.root, ".voratiq", "settings.yaml"),
      ["mcp:", "  gemini: never", ""].join("\n"),
      "utf8",
    );
    const promptForMcpInstall = jest.fn(() => Promise.resolve(true));
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: "No MCP servers configured.\n",
        stderr: "",
      }),
    );

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "gemini-test",
      sessionId: "20260401-123459-gemnv",
      launchMode: "first-party",
      promptForMcpInstall,
      mcpCommandRunner,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(promptForMcpInstall).not.toHaveBeenCalled();
    expect(mcpCommandRunner).not.toHaveBeenCalled();
    expect(prepared.prepared.toolAttachmentStatus).toBe("failed");
  });

  it("spawns prepared invocation, captures chat on exit, and marks session succeeded", async () => {
    const fixture = await createWorkspaceFixture();
    const sessionId = "20260401-120001-dones";

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    const expectedArtifactPath = join(
      prepared.prepared.sessionRoot,
      "artifacts",
      "chat.jsonl",
    );
    collectProviderArtifactsMock.mockResolvedValue({
      captured: true,
      format: "jsonl",
      artifactPath: expectedArtifactPath,
      sourceCount: 1,
    });

    const spawnResult = await spawnPreparedInteractiveSession(
      prepared.prepared,
      {
        stdio: "ignore",
      },
    );
    expect(spawnResult.ok).toBe(true);
    if (!spawnResult.ok) {
      return;
    }

    expect(registerActiveInteractiveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: prepared.prepared.root,
        sessionId,
        process: spawnResult.process,
        completion: expect.any(Promise),
      }),
    );

    const completedRecord = await spawnResult.completion;
    expect(completedRecord.status).toBe("succeeded");
    expect(completedRecord.chat).toMatchObject({
      captured: true,
      format: "jsonl",
      artifactPath: `.voratiq/interactive/sessions/${sessionId}/artifacts/chat.jsonl`,
    });

    const storedRecord = await readJson(prepared.prepared.recordPath);
    expect(storedRecord).toMatchObject({
      sessionId,
      status: "succeeded",
      chat: {
        captured: true,
        format: "jsonl",
      },
    });
    expect(finalizeActiveInteractiveMock).toHaveBeenCalledWith(sessionId);

    const storedIndex = await readJson<{
      sessions: Array<{ sessionId: string; status: string }>;
    }>(prepared.prepared.indexPath);
    expect(storedIndex.sessions).toEqual([
      expect.objectContaining({
        sessionId,
        status: "succeeded",
      }),
    ]);
  });

  it("prints a separator newline before inherit-stdio interactive launches", async () => {
    const fixture = await createWorkspaceFixture();
    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId: "20260401-120001-ttyln",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    const stdoutWriteSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const spawnResult = await spawnPreparedInteractiveSession(
        prepared.prepared,
        {
          stdio: "inherit",
        },
      );
      expect(spawnResult.ok).toBe(true);
      expect(stdoutWriteSpy).toHaveBeenCalledWith("\n");
      if (spawnResult.ok) {
        await spawnResult.completion;
      }
    } finally {
      stdoutWriteSpy.mockRestore();
    }
  });

  it("preserves chat capture failures in the final interactive record", async () => {
    const fixture = await createWorkspaceFixture();
    const sessionId = "20260401-120001-chaterr";

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    collectProviderArtifactsMock.mockResolvedValue({
      captured: false,
      error: new Error("transcript capture failed"),
    });

    const spawnResult = await spawnPreparedInteractiveSession(
      prepared.prepared,
      {
        stdio: "ignore",
      },
    );
    expect(spawnResult.ok).toBe(true);
    if (!spawnResult.ok) {
      return;
    }

    const completedRecord = await spawnResult.completion;
    expect(completedRecord.chat).toMatchObject({
      captured: false,
      errorMessage: "transcript capture failed",
    });
  });

  it("returns typed spawn failure and marks record failed when binary cannot start", async () => {
    const fixture = await createWorkspaceFixture();
    const sessionId = "20260401-120002-spawn";

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    const spawnFailure = await spawnPreparedInteractiveSession(
      {
        ...prepared.prepared,
        invocation: {
          ...prepared.prepared.invocation,
          command: join(fixture.root, "bin", "missing-binary"),
        },
      },
      { stdio: "ignore" },
    );

    expect(spawnFailure.ok).toBe(false);
    if (spawnFailure.ok) {
      return;
    }
    expect(spawnFailure.failure.code).toBe("process_spawn_failed");

    const storedRecord = await readJson(prepared.prepared.recordPath);
    expect(storedRecord).toMatchObject({
      sessionId,
      status: "failed",
      error: {
        code: "process_spawn_failed",
      },
    });
    await expect(access(prepared.prepared.runtimePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("passes the Claude prompt as a positional interactive message", async () => {
    const fixture = await createWorkspaceFixture({ provider: "claude" });
    const prompt = "Explain the current workspace and next steps.";

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "claude-test",
      prompt,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    expect(prepared.prepared.invocation.args).toContain(prompt);
    expect(prepared.prepared.invocation.args).not.toContain("-p");
    expect(prepared.prepared.invocation.args).not.toContain("--prompt");
    expect(
      prepared.prepared.invocation.args.filter((arg) => arg === prompt),
    ).toHaveLength(1);
    expect(prepared.prepared.invocation.args).not.toContain("high");
    expect(prepared.prepared.invocation.args).not.toContain(
      "--dangerously-skip-permissions",
    );
    expect(prepared.prepared.invocation.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it("keeps first-party Codex MCP attachment enabled across repeated preparations", async () => {
    const fixture = await createWorkspaceFixture();
    const sessionOne = "20260401-120004-codexa";
    const sessionTwo = "20260401-120005-codexb";
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          name: "voratiq",
          command: "node",
          args: ["/repo/dist/bin.js", "mcp", "--stdio"],
        }),
        stderr: "",
      }),
    );

    const first = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId: sessionOne,
      launchMode: "first-party",
      mcpCommandRunner,
      voratiqCliTarget: {
        command: "node",
        argsPrefix: ["/repo/dist/bin.js"],
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId: sessionTwo,
      launchMode: "first-party",
      mcpCommandRunner,
      voratiqCliTarget: {
        command: "node",
        argsPrefix: ["/repo/dist/bin.js"],
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }

    expect(first.prepared.toolAttachmentStatus).toBe("attached");
    expect(second.prepared.toolAttachmentStatus).toBe("attached");
    await expect(
      readFile(first.prepared.promptPath ?? "", "utf8"),
    ).resolves.toBe(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT);
    await expect(
      readFile(second.prepared.promptPath ?? "", "utf8"),
    ).resolves.toBe(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT);
    expect(first.prepared.invocation.env.CODEX_HOME).toBeUndefined();
    expect(second.prepared.invocation.env.CODEX_HOME).toBeUndefined();
  });
});

async function createWorkspaceFixture(
  options: {
    provider?: "codex" | "claude" | "gemini";
    binaryMissing?: boolean;
  } = {},
): Promise<{
  root: string;
  binaryPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-interactive-substrate-"));
  tempRoots.push(root);

  const voratiqDir = join(root, ".voratiq");
  const agentsPath = join(voratiqDir, "agents.yaml");
  const provider = options.provider ?? "codex";
  const agentId =
    provider === "claude"
      ? "claude-test"
      : provider === "gemini"
        ? "gemini-test"
        : "codex-test";
  const binaryPath = join(
    root,
    "bin",
    provider === "claude"
      ? "mock-claude.sh"
      : provider === "gemini"
        ? "mock-gemini.sh"
        : "mock-codex.sh",
  );

  await mkdir(voratiqDir, { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });

  if (!options.binaryMissing) {
    await writeFile(
      binaryPath,
      '#!/usr/bin/env bash\nexit "${MOCK_EXIT_CODE:-0}"\n',
      "utf8",
    );
    await chmod(binaryPath, 0o755);
  }

  await writeFile(
    agentsPath,
    `agents:\n  - id: ${agentId}\n    provider: ${provider}\n    model: gpt-5.4\n    binary: ${binaryPath}\n`,
    "utf8",
  );

  return { root, binaryPath };
}

async function readJson<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}
