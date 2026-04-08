import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { resolveFirstPartyMcpStatus } from "../../src/interactive/providers.js";
import type {
  NativeToolDeclaration,
  ProviderMcpCommandRunner,
} from "../../src/interactive/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("interactive providers", () => {
  it("treats codex MCP as attached only when command and args match", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
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

    const result = await resolveFirstPartyMcpStatus({
      providerId: "codex",
      root,
      toolDeclarations: [buildTool("voratiq")],
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
    expect(mcpCommandRunner).toHaveBeenCalledWith({
      command: "codex",
      args: ["mcp", "get", "--json", "voratiq"],
      cwd: root,
    });
  });

  it("uses the configured provider binary for codex MCP inspection when supplied", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
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

    const result = await resolveFirstPartyMcpStatus({
      providerId: "codex",
      providerBinary: "/opt/custom/bin/codex",
      root,
      toolDeclarations: [buildTool("voratiq")],
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledWith({
      command: "/opt/custom/bin/codex",
      args: ["mcp", "get", "--json", "voratiq"],
      cwd: root,
    });
  });

  it("surfaces missing provider binaries as inspection failures instead of uncaught exceptions", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);

    await expect(
      resolveFirstPartyMcpStatus({
        providerId: "codex",
        providerBinary: join(root, "missing-codex"),
        root,
        toolDeclarations: [buildTool("voratiq")],
      }),
    ).rejects.toThrow(/failed to inspect codex mcp configuration:/i);
  });

  it("installs missing codex MCP servers and verifies the effective config", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    let installed = false;
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "get") {
        return Promise.resolve(
          installed
            ? {
                exitCode: 0,
                stdout: JSON.stringify({
                  name: "voratiq",
                  command: "node",
                  args: ["/repo/dist/bin.js", "mcp", "--stdio"],
                }),
                stderr: "",
              }
            : {
                exitCode: 1,
                stdout: "",
                stderr: "No MCP server found with name: voratiq",
              },
        );
      }
      if (input.args[1] === "add") {
        installed = true;
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "codex",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(1, {
      command: "codex",
      args: ["mcp", "get", "--json", "voratiq"],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(2, {
      command: "codex",
      args: [
        "mcp",
        "add",
        "voratiq",
        "--",
        "node",
        "/repo/dist/bin.js",
        "mcp",
        "--stdio",
      ],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(3, {
      command: "codex",
      args: ["mcp", "get", "--json", "voratiq"],
      cwd: root,
    });
  });

  it("treats codex 'No MCP server named' output as missing and prompts for install", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    let installed = false;
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "get") {
        return Promise.resolve(
          installed
            ? {
                exitCode: 0,
                stdout: JSON.stringify({
                  name: "voratiq",
                  command: "node",
                  args: ["/repo/dist/bin.js", "mcp", "--stdio"],
                }),
                stderr: "",
              }
            : {
                exitCode: 1,
                stdout: "",
                stderr: "Error: No MCP server named 'voratiq' found.",
              },
        );
      }
      if (input.args[1] === "add") {
        installed = true;
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "codex",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(3);
  });

  it("fails when an effective codex MCP entry conflicts with the expected command", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "get") {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            name: "voratiq",
            command: "node",
            args: ["/wrong/path.js", "mcp", "--stdio"],
          }),
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    await expect(
      resolveFirstPartyMcpStatus({
        providerId: "codex",
        root,
        toolDeclarations: [buildTool("voratiq")],
        promptForMcpInstall: () => Promise.resolve(true),
        mcpCommandRunner,
      }),
    ).rejects.toThrow(
      /conflicting effective `voratiq` MCP entry is already configured for codex/i,
    );
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
  });

  it("fails when an effective claude MCP entry conflicts with the expected command", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "get") {
        return Promise.resolve({
          exitCode: 0,
          stdout:
            "voratiq:\n  Scope: User config\n  Status: ✓ Connected\n  Type: stdio\n  Command: node\n  Args: /wrong/path.js mcp --stdio\n  Environment:\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    await expect(
      resolveFirstPartyMcpStatus({
        providerId: "claude",
        root,
        toolDeclarations: [buildTool("voratiq")],
        promptForMcpInstall: () => Promise.resolve(true),
        mcpCommandRunner,
      }),
    ).rejects.toThrow(
      /conflicting effective `voratiq` MCP entry is already configured for claude/i,
    );
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
  });

  it("installs missing claude MCP servers and verifies the effective config", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    let installed = false;
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "get") {
        return Promise.resolve(
          installed
            ? {
                exitCode: 0,
                stdout:
                  "voratiq:\n  Scope: User config\n  Status: ✓ Connected\n  Type: stdio\n  Command: node\n  Args: /repo/dist/bin.js mcp --stdio\n  Environment:\n",
                stderr: "",
              }
            : {
                exitCode: 1,
                stdout: "",
                stderr: "No MCP server found with name: voratiq",
              },
        );
      }
      if (input.args[1] === "add") {
        installed = true;
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "claude",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(1, {
      command: "claude",
      args: ["mcp", "get", "voratiq"],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(2, {
      command: "claude",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "voratiq",
        "--",
        "node",
        "/repo/dist/bin.js",
        "mcp",
        "--stdio",
      ],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(3, {
      command: "claude",
      args: ["mcp", "get", "voratiq"],
      cwd: root,
    });
  });

  it("treats gemini MCP as attached only when the effective command matches", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: [
          "✓ voratiq: node /repo/dist/bin.js mcp --stdio (stdio) - Connected",
          "",
        ].join("\n"),
        stderr: "",
      }),
    );

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq")],
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
    expect(mcpCommandRunner).toHaveBeenCalledWith({
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
    });
  });

  it("parses attached gemini MCP entries when list output is written to stderr", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: [
          "Configured MCP servers:",
          "",
          "✓ voratiq: node /repo/dist/bin.js mcp --stdio (stdio) - Connected",
          "",
        ].join("\n"),
      }),
    );

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq")],
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
  });

  it("fails when an effective gemini MCP entry conflicts with the expected command", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout:
          "✓ voratiq: node /wrong/path.js mcp --stdio (stdio) - Connected\n",
        stderr: "",
      }),
    );

    await expect(
      resolveFirstPartyMcpStatus({
        providerId: "gemini",
        root,
        toolDeclarations: [buildTool("voratiq")],
        promptForMcpInstall: () => Promise.resolve(true),
        mcpCommandRunner,
      }),
    ).rejects.toThrow(
      /conflicting effective `voratiq` MCP entry is already configured for gemini/i,
    );
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
  });

  it("installs missing gemini MCP servers via gemini mcp add", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
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
        installed.add(String(input.args[5]));
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server voratiq\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(1, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
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
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(3, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
    });
  });

  it("retries gemini MCP verification until the installed entry becomes visible", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    let installed = false;
    let inspectCount = 0;
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "list") {
        inspectCount += 1;
        const entryVisible = installed && inspectCount >= 4;
        return Promise.resolve({
          exitCode: 0,
          stdout: entryVisible
            ? "✓ voratiq: node /repo/dist/bin.js mcp --stdio (stdio) - Connected\n"
            : "No MCP servers configured.\n",
          stderr: "",
        });
      }
      if (input.args[1] === "add") {
        installed = true;
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server voratiq\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(1, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
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
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenCalledTimes(5);
  });

  it("installs all declared gemini MCP tool entries when prompted", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const installed = new Set<string>();
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "list") {
        return Promise.resolve({
          exitCode: 0,
          stdout:
            installed.size === 0
              ? "No MCP servers configured.\n"
              : [...installed]
                  .map(
                    (name) =>
                      `✓ ${name}: node /repo/dist/bin.js mcp --stdio (stdio) - Connected`,
                  )
                  .join("\n"),
          stderr: "",
        });
      }
      if (input.args[1] === "add") {
        installed.add(String(input.args[5]));
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq"), buildTool("voratiq_extra")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(4);
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
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(3, {
      command: "gemini",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "--trust",
        "voratiq_extra",
        "node",
        "/repo/dist/bin.js",
        "mcp",
        "--stdio",
      ],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(4, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
    });
  });

  it("installs only missing gemini MCP entries for partial installs", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const installed = new Set<string>(["voratiq"]);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>((input) => {
      if (input.args[1] === "list") {
        return Promise.resolve({
          exitCode: 0,
          stdout: [...installed]
            .map(
              (name) =>
                `✓ ${name}: node /repo/dist/bin.js mcp --stdio (stdio) - Connected`,
            )
            .join("\n"),
          stderr: "",
        });
      }
      if (input.args[1] === "add") {
        installed.add(String(input.args[5]));
        return Promise.resolve({
          exitCode: 0,
          stdout: "Added server\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    });

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq"), buildTool("voratiq_extra")],
      promptForMcpInstall: () => Promise.resolve(true),
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("attached");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(3);
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(1, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(2, {
      command: "gemini",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "--trust",
        "voratiq_extra",
        "node",
        "/repo/dist/bin.js",
        "mcp",
        "--stdio",
      ],
      cwd: root,
    });
    expect(mcpCommandRunner).toHaveBeenNthCalledWith(3, {
      command: "gemini",
      args: ["mcp", "list"],
      cwd: root,
    });
  });

  it("fails when gemini MCP is missing and install prompt is declined", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    const mcpCommandRunner = jest.fn<ProviderMcpCommandRunner>(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: "No MCP servers configured.\n",
        stderr: "",
      }),
    );

    const promptForMcpInstall = jest.fn(() => Promise.resolve(false));
    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall,
      mcpCommandRunner,
    });

    expect(promptForMcpInstall).toHaveBeenCalledTimes(1);
    expect(result.toolAttachmentStatus).toBe("failed");
    expect(mcpCommandRunner).toHaveBeenCalledTimes(1);
  });

  it("does not prompt when gemini MCP preference is never", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-interactive-providers-"),
    );
    tempRoots.push(root);
    await mkdir(join(root, ".voratiq"), { recursive: true });
    await writeFile(
      join(root, ".voratiq", "settings.yaml"),
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

    const result = await resolveFirstPartyMcpStatus({
      providerId: "gemini",
      root,
      toolDeclarations: [buildTool("voratiq")],
      promptForMcpInstall,
      mcpCommandRunner,
    });

    expect(result.toolAttachmentStatus).toBe("failed");
    expect(promptForMcpInstall).not.toHaveBeenCalled();
    expect(mcpCommandRunner).not.toHaveBeenCalled();
  });
});

function buildTool(name: string): NativeToolDeclaration {
  return {
    name,
    command: "node",
    args: ["/repo/dist/bin.js", "mcp", "--stdio"],
  };
}
