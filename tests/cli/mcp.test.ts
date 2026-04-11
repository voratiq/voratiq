import { realpath } from "node:fs/promises";
import { symlink } from "node:fs/promises";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, jest } from "@jest/globals";
import { z } from "zod";

import {
  externalApplyExecutionInputSchema,
  externalInspectionModes,
  externalInspectionOperators,
  externalMessageExecutionInputSchema,
  externalReduceExecutionInputSchema,
  externalRunExecutionInputSchema,
  externalSpecExecutionInputSchema,
  externalVerifyExecutionInputSchema,
} from "../../src/cli/contract.js";
import type { OperatorResultEnvelope } from "../../src/cli/operator-envelope.js";
import {
  createEntrypointCliTarget,
  createVoratiqMcpRequestHandler,
  getVoratiqMcpToolDefinitions,
  type InvokeCliJsonContract,
  resolveVoratiqCliTarget,
  runVoratiqMcpStdioServer,
  type TransportFailureResult,
  VORATIQ_MCP_PROTOCOL_VERSION,
  VORATIQ_SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from "../../src/mcp/server.js";

type RequestHandler = ReturnType<typeof createVoratiqMcpRequestHandler>;

interface JsonRpcSuccessResult<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result: T;
}

interface JsonRpcErrorResult {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResult<T> = JsonRpcSuccessResult<T> | JsonRpcErrorResult;

interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: Record<string, unknown>;
  };
  instructions?: string;
  serverInfo: {
    name: string;
    version: string;
  };
}

interface ToolListResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

interface CallToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
  isError: boolean;
}

describe("bundled MCP server", () => {
  let originalPath: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it("exposes exactly eight tool definitions with contract-derived schemas", () => {
    const definitions = getVoratiqMcpToolDefinitions();
    expect(definitions.map((definition) => definition.name)).toEqual([
      "voratiq_spec",
      "voratiq_run",
      "voratiq_reduce",
      "voratiq_verify",
      "voratiq_message",
      "voratiq_apply",
      "voratiq_list",
      "voratiq_prune",
    ]);

    const expectedInputSchemas = {
      voratiq_spec: toInputSchema(externalSpecExecutionInputSchema),
      voratiq_run: toInputSchema(externalRunExecutionInputSchema),
      voratiq_reduce: toInputSchema(externalReduceExecutionInputSchema),
      voratiq_verify: toInputSchema(externalVerifyExecutionInputSchema),
      voratiq_message: toInputSchema(externalMessageExecutionInputSchema),
      voratiq_apply: toInputSchema(externalApplyExecutionInputSchema),
      voratiq_prune: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["run", "all"],
          },
          runId: {
            type: "string",
            minLength: 1,
            description: "Required when scope is `run`.",
          },
          purge: {
            type: "boolean",
          },
          confirmed: {
            type: "boolean",
            const: true,
            description: "Must be true to confirm prune operations.",
          },
        },
        required: ["scope", "confirmed"],
        additionalProperties: false,
      },
      voratiq_list: {
        type: "object",
        properties: {
          operator: {
            type: "string",
            enum: [...externalInspectionOperators],
          },
          mode: {
            type: "string",
            enum: [...externalInspectionModes],
            description:
              "Use `detail` only when inspecting a specific session.",
          },
          sessionId: {
            type: "string",
            minLength: 1,
            description: "Required when mode is `detail`.",
          },
          verbose: {
            type: "boolean",
          },
          limit: {
            type: "integer",
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
          },
        },
        required: ["operator", "mode"],
        additionalProperties: false,
      },
    } as const;

    for (const definition of definitions) {
      expect(normalizeSchema(definition.inputSchema)).toEqual(
        normalizeSchema(
          expectedInputSchemas[
            definition.name as keyof typeof expectedInputSchemas
          ],
        ),
      );
    }
  });

  it("initializes for MCP protocol 2025-11-25 and lists tool capabilities", async () => {
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    const handler = createVoratiqMcpRequestHandler({
      invokeCliJsonContract: invokeCliJsonContractMock,
      serverVersion: "0.1.0-test",
    });

    const initializeResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
      },
    });
    const initialized = expectSuccess<InitializeResult>(initializeResponse);
    expect(initialized.protocolVersion).toBe(VORATIQ_MCP_PROTOCOL_VERSION);
    expect(initialized.capabilities).toEqual({
      tools: {
        listChanged: true,
      },
    });
    expect(initialized.instructions).toContain("Use voratiq_list");
    expect(initialized.serverInfo).toEqual({
      name: "voratiq",
      version: "0.1.0-test",
    });

    const toolsResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = expectSuccess<ToolListResult>(toolsResponse);
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "voratiq_spec",
      "voratiq_run",
      "voratiq_reduce",
      "voratiq_verify",
      "voratiq_message",
      "voratiq_apply",
      "voratiq_list",
      "voratiq_prune",
    ]);
    expect(invokeCliJsonContractMock).not.toHaveBeenCalled();
  });

  it("exposes Claude-compatible top-level object schemas for every MCP tool", () => {
    const definitions = getVoratiqMcpToolDefinitions();
    for (const definition of definitions) {
      expect(definition.inputSchema.type).toBe("object");
      expect(Object.keys(definition.inputSchema)).not.toContain("anyOf");
      expect(Object.keys(definition.inputSchema)).not.toContain("oneOf");
    }
  });

  it("initializes for MCP protocol 2024-11-05 and echoes the negotiated version", async () => {
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    const handler = createVoratiqMcpRequestHandler({
      invokeCliJsonContract: invokeCliJsonContractMock,
      serverVersion: "0.1.0-test",
    });

    const initializeResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
      },
    });
    const initialized = expectSuccess<InitializeResult>(initializeResponse);
    expect(initialized.protocolVersion).toBe("2024-11-05");

    const toolsResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = expectSuccess<ToolListResult>(toolsResponse);
    expect(tools.tools).toHaveLength(8);
    expect(invokeCliJsonContractMock).not.toHaveBeenCalled();
  });

  it("initializes for MCP protocol 2025-06-18 and echoes the negotiated version", async () => {
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    const handler = createVoratiqMcpRequestHandler({
      invokeCliJsonContract: invokeCliJsonContractMock,
      serverVersion: "0.1.0-test",
    });

    const initializeResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
      },
    });
    const initialized = expectSuccess<InitializeResult>(initializeResponse);
    expect(initialized.protocolVersion).toBe("2025-06-18");

    const toolsResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = expectSuccess<ToolListResult>(toolsResponse);
    expect(tools.tools).toHaveLength(8);
    expect(invokeCliJsonContractMock).not.toHaveBeenCalled();
  });

  it("returns supported protocol versions when initialization uses an unsupported MCP version", async () => {
    const handler = createVoratiqMcpRequestHandler({
      serverVersion: "0.1.0-test",
    });

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "1999-01-01",
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32602,
        message: "Unsupported MCP protocol version.",
        data: {
          expectedProtocolVersion: VORATIQ_MCP_PROTOCOL_VERSION,
          supportedProtocolVersions: [
            ...VORATIQ_SUPPORTED_MCP_PROTOCOL_VERSIONS,
          ],
          receivedProtocolVersion: "1999-01-01",
        },
      },
    });
  });

  it("serves stdio JSON-RPC frames without non-protocol output", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;

    const responsesPromise = collectFramedResponses(stdout, 3);
    const serverPromise = runVoratiqMcpStdioServer({
      stdin,
      stdout,
      invokeCliJsonContract: invokeCliJsonContractMock,
      serverVersion: "0.1.0-test",
    });

    stdin.write(
      toFramedJson({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
        },
      }),
    );
    stdin.write(
      toFramedJson({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    );
    stdin.end();

    const responses = await responsesPromise;
    await serverPromise;

    expect(responses).toHaveLength(3);
    expect(expectSuccess<InitializeResult>(responses[0]).protocolVersion).toBe(
      "2025-11-25",
    );
    expect(responses[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });
    expect(expectSuccess<ToolListResult>(responses[2]).tools).toHaveLength(8);
    expect(invokeCliJsonContractMock).not.toHaveBeenCalled();
  });

  it("accepts LF-only framed stdio JSON-RPC requests", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const responsesPromise = collectFramedResponses(stdout, 3);
    const serverPromise = runVoratiqMcpStdioServer({
      stdin,
      stdout,
      serverVersion: "0.1.0-test",
    });

    stdin.write(
      toFramedJson(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
          },
        },
        "\n\n",
      ),
    );
    stdin.write(
      toFramedJson(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        },
        "\n\n",
      ),
    );
    stdin.end();

    const responses = await responsesPromise;
    await serverPromise;

    expect(expectSuccess<InitializeResult>(responses[0]).protocolVersion).toBe(
      "2025-11-25",
    );
    expect(responses[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });
    expect(expectSuccess<ToolListResult>(responses[2]).tools).toHaveLength(8);
  });

  it("accepts newline-delimited JSON-RPC requests and replies with newline-delimited JSON", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const responsesPromise = collectJsonLineResponses(stdout, 3);
    const serverPromise = runVoratiqMcpStdioServer({
      stdin,
      stdout,
      serverVersion: "0.1.0-test",
    });

    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
        },
      })}\n`,
    );
    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      })}\n`,
    );
    stdin.end();

    const responses = await responsesPromise;
    await serverPromise;

    expect(expectSuccess<InitializeResult>(responses[0]).protocolVersion).toBe(
      "2025-11-25",
    );
    expect(responses[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });
    expect(expectSuccess<ToolListResult>(responses[2]).tools).toHaveLength(8);
  });

  it("routes execution tools through voratiq <operator> --json and returns envelope output", async () => {
    const envelope: OperatorResultEnvelope = {
      version: 1,
      operator: "spec",
      status: "succeeded",
      timestamp: "2026-03-31T12:00:00.000Z",
      artifacts: [],
    };
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    invokeCliJsonContractMock.mockResolvedValue({
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(envelope),
      stderr: "",
    });
    const handler = await createInitializedHandler(invokeCliJsonContractMock);

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "voratiq_spec",
        arguments: {
          description: "Build task",
          agentIds: ["agent-a", "agent-b"],
          profile: "default",
          maxParallel: 2,
          title: "Task title",
          extraContext: ["docs/context.md"],
        },
      },
    });
    const result = expectSuccess<CallToolResult>(response);

    expect(invokeCliJsonContractMock).toHaveBeenCalledWith({
      operator: "spec",
      args: [
        "spec",
        "--description",
        "Build task",
        "--agent",
        "agent-a",
        "--agent",
        "agent-b",
        "--profile",
        "default",
        "--max-parallel",
        "2",
        "--title",
        "Task title",
        "--extra-context",
        "docs/context.md",
        "--json",
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(envelope);
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(envelope),
      },
    ]);
  });

  it("routes voratiq_message through voratiq message --json", async () => {
    const envelope: OperatorResultEnvelope = {
      version: 1,
      operator: "message",
      status: "succeeded",
      timestamp: "2026-03-31T12:01:00.000Z",
      ids: {
        sessionId: "message-123",
      },
      artifacts: [
        {
          kind: "session",
          role: "session",
          path: ".voratiq/message/sessions/message-123",
        },
      ],
    };
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    invokeCliJsonContractMock.mockResolvedValue({
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(envelope),
      stderr: "",
    });
    const handler = await createInitializedHandler(invokeCliJsonContractMock);

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "voratiq_message",
        arguments: {
          prompt: "Review task",
          agentIds: ["agent-a", "agent-b"],
          profile: "default",
          maxParallel: 2,
          extraContext: ["docs/context.md"],
        },
      },
    });
    const result = expectSuccess<CallToolResult>(response);

    expect(invokeCliJsonContractMock).toHaveBeenCalledWith({
      operator: "message",
      args: [
        "message",
        "--prompt",
        "Review task",
        "--agent",
        "agent-a",
        "--agent",
        "agent-b",
        "--profile",
        "default",
        "--max-parallel",
        "2",
        "--extra-context",
        "docs/context.md",
        "--json",
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(envelope);
  });

  it("routes voratiq_verify message targets through voratiq verify --message --json", async () => {
    const envelope: OperatorResultEnvelope = {
      version: 1,
      operator: "verify",
      status: "succeeded",
      timestamp: "2026-03-31T12:02:00.000Z",
      ids: {
        sessionId: "verify-123",
        messageId: "message-123",
      },
      target: {
        kind: "message",
        sessionId: "message-123",
      },
      artifacts: [
        {
          kind: "session",
          role: "session",
          path: ".voratiq/verify/sessions/verify-123",
        },
      ],
    };
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    invokeCliJsonContractMock.mockResolvedValue({
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(envelope),
      stderr: "",
    });
    const handler = await createInitializedHandler(invokeCliJsonContractMock);

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "voratiq_verify",
        arguments: {
          target: {
            kind: "message",
            sessionId: "message-123",
          },
        },
      },
    });
    const result = expectSuccess<CallToolResult>(response);

    expect(invokeCliJsonContractMock).toHaveBeenCalledWith({
      operator: "verify",
      args: ["verify", "--message", "message-123", "--json"],
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(envelope);
  });

  it("marks valid envelopes with non-zero exits as tool errors while preserving envelope payload", async () => {
    const envelope: OperatorResultEnvelope = {
      version: 1,
      operator: "run",
      status: "succeeded",
      timestamp: "2026-03-31T12:05:00.000Z",
      ids: {
        runId: "run-123",
      },
      artifacts: [],
    };
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    invokeCliJsonContractMock.mockResolvedValue({
      kind: "success",
      exitCode: 2,
      stdout: JSON.stringify(envelope),
      stderr: "",
    });
    const handler = await createInitializedHandler(invokeCliJsonContractMock);

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "voratiq_run",
        arguments: {
          specPath: "specs/task.md",
        },
      },
    });
    const result = expectSuccess<CallToolResult>(response);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(envelope);
  });

  it("returns stable list contract output and keeps detail misses non-errors", async () => {
    const listPayload = {
      operator: "verify",
      mode: "detail",
      sessionId: "verify-missing",
      session: null,
      warnings: ["Lookup used on-disk index."],
    };
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    invokeCliJsonContractMock.mockResolvedValue({
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(listPayload),
      stderr: "",
    });
    const handler = await createInitializedHandler(invokeCliJsonContractMock);

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "voratiq_list",
        arguments: {
          operator: "verify",
          mode: "detail",
          sessionId: "verify-missing",
        },
      },
    });
    const result = expectSuccess<CallToolResult>(response);

    expect(invokeCliJsonContractMock).toHaveBeenCalledWith({
      operator: "list",
      args: ["list", "--verify", "verify-missing", "--json"],
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(listPayload);
  });

  it("rejects prune without confirmed: true as invalid_input before spawning", async () => {
    const invokeCliJsonContractMock =
      jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
    const handler = await createInitializedHandler(invokeCliJsonContractMock);

    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "voratiq_prune",
        arguments: {
          scope: "all",
        },
      },
    });
    const result = expectSuccess<CallToolResult>(response);
    const failure = result.structuredContent as TransportFailureResult;

    expect(failure.failureKind).toBe("invalid_input");
    expect(failure.operator).toBe("prune");
    expect(result.isError).toBe(true);
    expect(invokeCliJsonContractMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "spawn_failed",
      invocation: {
        kind: "spawn_failed" as const,
        error: new Error("spawn ENOENT"),
      },
      expectedFailureKind: "spawn_failed",
    },
    {
      name: "malformed_json",
      invocation: {
        kind: "success" as const,
        exitCode: 1,
        stdout: "not-json",
        stderr: "",
      },
      expectedFailureKind: "malformed_json",
    },
    {
      name: "contract_mismatch",
      invocation: {
        kind: "success" as const,
        exitCode: 0,
        stdout: JSON.stringify({ unexpected: true }),
        stderr: "",
      },
      expectedFailureKind: "contract_mismatch",
    },
  ])(
    "returns %s transport failure results without envelope replacement",
    async ({ invocation, expectedFailureKind }) => {
      const invokeCliJsonContractMock =
        jest.fn() as jest.MockedFunction<InvokeCliJsonContract>;
      invokeCliJsonContractMock.mockResolvedValue(invocation);
      const handler = await createInitializedHandler(invokeCliJsonContractMock);

      const response = await handler.handleRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "voratiq_verify",
          arguments: {
            target: {
              kind: "run",
              sessionId: "run-123",
            },
          },
        },
      });
      const result = expectSuccess<CallToolResult>(response);
      const failure = result.structuredContent as TransportFailureResult;

      expect(result.isError).toBe(true);
      expect(failure).toMatchObject({
        failureKind: expectedFailureKind,
        operator: "verify",
      });
    },
  );

  it("prefers the current CLI entrypoint even when voratiq is on PATH", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "voratiq-mcp-bin-"));
    const fakeVoratiqPath = join(binDir, "voratiq");
    await writeFile(fakeVoratiqPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeVoratiqPath, 0o755);
    process.env.PATH = binDir;

    try {
      expect(
        createEntrypointCliTarget({
          cliEntrypoint: "/repo/dist/bin.js",
          nodeExecutable: process.execPath,
        }),
      ).toEqual({
        command: process.execPath,
        argsPrefix: ["/repo/dist/bin.js"],
      });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("falls back to an installed voratiq binary when no current entrypoint is available", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "voratiq-mcp-bin-"));
    const fakeVoratiqPath = join(binDir, "voratiq");
    const distDir = join(
      binDir,
      "..",
      "lib",
      "node_modules",
      "voratiq",
      "dist",
    );
    const distBinPath = join(distDir, "bin.js");
    await mkdir(distDir, { recursive: true });
    await writeFile(distBinPath, "console.log('ok');\n", "utf8");
    await chmod(distBinPath, 0o755);
    await symlink("../lib/node_modules/voratiq/dist/bin.js", fakeVoratiqPath);
    process.env.PATH = binDir;
    const resolvedDistBinPath = await realpath(distBinPath);

    try {
      expect(resolveVoratiqCliTarget()).toEqual({
        command: process.execPath,
        argsPrefix: [resolvedDistBinPath],
      });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("wraps an explicit CLI entrypoint path for self re-exec", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "voratiq-mcp-bin-"));
    const fakeVoratiqPath = join(binDir, "voratiq");
    await writeFile(fakeVoratiqPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeVoratiqPath, 0o755);
    process.env.PATH = binDir;

    try {
      expect(
        createEntrypointCliTarget({
          cliEntrypoint: "/host-app/index.js",
          nodeExecutable: process.execPath,
        }),
      ).toEqual({
        command: process.execPath,
        argsPrefix: ["/host-app/index.js"],
      });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("uses node plus the resolved script when the CLI entrypoint is a wrapper symlink", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "voratiq-mcp-bin-"));
    const fakeVoratiqPath = join(binDir, "voratiq");
    const distDir = join(
      binDir,
      "..",
      "lib",
      "node_modules",
      "voratiq",
      "dist",
    );
    const distBinPath = join(distDir, "bin.js");
    await mkdir(distDir, { recursive: true });
    await writeFile(distBinPath, "console.log('ok');\n", "utf8");
    await chmod(distBinPath, 0o755);
    await symlink("../lib/node_modules/voratiq/dist/bin.js", fakeVoratiqPath);
    const resolvedDistBinPath = await realpath(distBinPath);

    try {
      expect(
        createEntrypointCliTarget({
          cliEntrypoint: fakeVoratiqPath,
          nodeExecutable: process.execPath,
        }),
      ).toEqual({
        command: process.execPath,
        argsPrefix: [resolvedDistBinPath],
      });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("uses a non-script executable CLI entrypoint directly for self re-exec", () => {
    expect(
      createEntrypointCliTarget({
        cliEntrypoint: "/Users/me/bin/voratiq-native",
        nodeExecutable: process.execPath,
      }),
    ).toEqual({
      command: "/Users/me/bin/voratiq-native",
      argsPrefix: [],
    });
  });

  it("falls back to a bare voratiq command when no current entrypoint or installed binary is found", () => {
    process.env.PATH = "";

    expect(resolveVoratiqCliTarget()).toEqual({
      command: "voratiq",
      argsPrefix: [],
    });
  });
});

async function createInitializedHandler(
  invokeCliJsonContract: InvokeCliJsonContract,
): Promise<RequestHandler> {
  const handler = createVoratiqMcpRequestHandler({
    invokeCliJsonContract,
    serverVersion: "0.1.0-test",
  });

  const initResponse = await handler.handleRequest({
    jsonrpc: "2.0",
    id: "init",
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
    },
  });
  expectSuccess<InitializeResult>(initResponse);
  return handler;
}

function expectSuccess<T>(result: unknown): T {
  const typed = result as JsonRpcResult<T>;
  if ("error" in typed) {
    throw new Error(
      `Expected JSON-RPC success result, received error: ${typed.error.message}`,
    );
  }
  return typed.result;
}

function toInputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    io: "input",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function normalizeSchema(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((entry) => normalizeSchema(entry));
  }
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => [key, normalizeSchema(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries);
  }
  return input;
}

function toFramedJson(payload: unknown, delimiter = "\r\n\r\n"): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.from(`Content-Length: ${body.byteLength}${delimiter}`);
  return Buffer.concat([header, body]);
}

async function collectFramedResponses(
  stream: PassThrough,
  expectedCount: number,
): Promise<unknown[]> {
  return await new Promise<unknown[]>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const messages: unknown[] = [];

    const cleanup = (): void => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onEnd = (): void => {
      if (messages.length >= expectedCount) {
        cleanup();
        resolve(messages);
        return;
      }
      cleanup();
      reject(
        new Error(
          `Expected ${expectedCount} responses, received ${messages.length}.`,
        ),
      );
    };

    const onData = (chunk: Buffer | string): void => {
      buffer = Buffer.concat([
        buffer,
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
      ]);

      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          break;
        }
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const contentLengthLine = header
          .split("\r\n")
          .find((line) => line.toLowerCase().startsWith("content-length:"));
        if (!contentLengthLine) {
          cleanup();
          reject(new Error("Missing Content-Length header in response frame."));
          return;
        }
        const contentLength = Number(contentLengthLine.split(":")[1]?.trim());
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          cleanup();
          reject(new Error("Invalid Content-Length in response frame."));
          return;
        }
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (buffer.length < bodyEnd) {
          break;
        }
        const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
        messages.push(JSON.parse(body) as unknown);
        buffer = buffer.subarray(bodyEnd);
      }

      if (messages.length >= expectedCount) {
        cleanup();
        resolve(messages);
      }
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

async function collectJsonLineResponses(
  stream: PassThrough,
  expectedCount: number,
): Promise<unknown[]> {
  return await new Promise<unknown[]>((resolve, reject) => {
    let buffer = "";
    const messages: unknown[] = [];

    const cleanup = (): void => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onEnd = (): void => {
      if (messages.length >= expectedCount) {
        cleanup();
        resolve(messages);
        return;
      }
      cleanup();
      reject(
        new Error(
          `Expected ${expectedCount} responses, received ${messages.length}.`,
        ),
      );
    };

    const onData = (chunk: Buffer | string): void => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = buffer.slice(0, newlineIndex).replace(/\r$/u, "").trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length === 0) {
          continue;
        }
        messages.push(JSON.parse(line) as unknown);
      }

      if (messages.length >= expectedCount) {
        cleanup();
        resolve(messages);
      }
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
