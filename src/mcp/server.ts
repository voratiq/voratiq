import { spawn } from "node:child_process";
import process from "node:process";

import { z } from "zod";

import {
  type ExternalApplyExecutionInput,
  externalApplyExecutionInputSchema,
  type ExternalListInspectionInput,
  externalListInspectionInputSchema,
  type ExternalPruneExecutionInput,
  externalPruneExecutionInputSchema,
  type ExternalReduceExecutionInput,
  externalReduceExecutionInputSchema,
  type ExternalRunExecutionInput,
  externalRunExecutionInputSchema,
  type ExternalSpecExecutionInput,
  externalSpecExecutionInputSchema,
  type ExternalVerifyExecutionInput,
  externalVerifyExecutionInputSchema,
} from "../cli/contract.js";
import {
  type OperatorResultEnvelope,
  operatorResultEnvelopeSchema,
} from "../cli/operator-envelope.js";
import {
  type ListJsonOutput,
  listJsonOutputSchema,
} from "../contracts/list.js";
import { detectBinary } from "../utils/binaries.js";
import { getVoratiqVersion } from "../utils/version.js";

const JSON_RPC_VERSION = "2.0" as const;
const HEADER_DELIMITER = Buffer.from("\r\n\r\n", "utf8");

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;

export const VORATIQ_MCP_PROTOCOL_VERSION = "2025-11-25" as const;

export type VoratiqMcpExecutionToolName =
  | "voratiq_spec"
  | "voratiq_run"
  | "voratiq_reduce"
  | "voratiq_verify"
  | "voratiq_apply"
  | "voratiq_prune";

export type VoratiqMcpToolName = VoratiqMcpExecutionToolName | "voratiq_list";

export type VoratiqMcpOperator =
  | "spec"
  | "run"
  | "reduce"
  | "verify"
  | "apply"
  | "prune"
  | "list";

export type TransportFailureKind =
  | "invalid_input"
  | "spawn_failed"
  | "malformed_json"
  | "contract_mismatch";

export interface TransportFailureResult {
  failureKind: TransportFailureKind;
  operator: VoratiqMcpOperator;
  message: string;
  details?: unknown;
}

export interface McpToolDefinition {
  name: VoratiqMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolSpec {
  readonly name: VoratiqMcpToolName;
  readonly operator: VoratiqMcpOperator;
  readonly description: string;
  readonly inputSchemaSource: z.ZodTypeAny;
  readonly buildArgs: (input: unknown) => string[];
  readonly outputContract: "execution" | "list";
}

interface CliInvocationSuccess {
  kind: "success";
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CliInvocationSpawnFailed {
  kind: "spawn_failed";
  error: Error;
}

type CliInvocationResult = CliInvocationSuccess | CliInvocationSpawnFailed;

interface InvokeCliJsonContractInput {
  operator: VoratiqMcpOperator;
  args: string[];
}

export type InvokeCliJsonContract = (
  input: InvokeCliJsonContractInput,
) => Promise<CliInvocationResult>;

export interface CreateVoratiqMcpRequestHandlerOptions {
  invokeCliJsonContract?: InvokeCliJsonContract;
  serverVersion?: string;
}

interface JsonRpcRequestMessage {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type JsonRpcIncomingMessage =
  | JsonRpcRequestMessage
  | JsonRpcNotificationMessage;

interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface CallToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
  isError: boolean;
}

const initializeRequestParamsSchema = z
  .object({
    protocolVersion: z.string(),
  })
  .passthrough();

const callToolParamsSchema = z
  .object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const toolSpecs: readonly ToolSpec[] = [
  {
    name: "voratiq_spec",
    operator: "spec",
    description:
      "Invoke `voratiq spec --json` using the external execution contract.",
    inputSchemaSource: externalSpecExecutionInputSchema,
    buildArgs: (input) =>
      buildSpecExecutionArgs(input as ExternalSpecExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_run",
    operator: "run",
    description:
      "Invoke `voratiq run --json` using the external execution contract.",
    inputSchemaSource: externalRunExecutionInputSchema,
    buildArgs: (input) =>
      buildRunExecutionArgs(input as ExternalRunExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_reduce",
    operator: "reduce",
    description:
      "Invoke `voratiq reduce --json` using the external execution contract.",
    inputSchemaSource: externalReduceExecutionInputSchema,
    buildArgs: (input) =>
      buildReduceExecutionArgs(input as ExternalReduceExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_verify",
    operator: "verify",
    description:
      "Invoke `voratiq verify --json` using the external execution contract.",
    inputSchemaSource: externalVerifyExecutionInputSchema,
    buildArgs: (input) =>
      buildVerifyExecutionArgs(input as ExternalVerifyExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_apply",
    operator: "apply",
    description:
      "Invoke `voratiq apply --json` using the external execution contract.",
    inputSchemaSource: externalApplyExecutionInputSchema,
    buildArgs: (input) =>
      buildApplyExecutionArgs(input as ExternalApplyExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_prune",
    operator: "prune",
    description:
      "Invoke `voratiq prune --json` using the external execution contract.",
    inputSchemaSource: externalPruneExecutionInputSchema,
    buildArgs: (input) =>
      buildPruneExecutionArgs(input as ExternalPruneExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_list",
    operator: "list",
    description:
      "Invoke `voratiq list --json` using the external inspection contract.",
    inputSchemaSource: externalListInspectionInputSchema,
    buildArgs: (input) =>
      buildListInspectionArgs(input as ExternalListInspectionInput),
    outputContract: "list",
  },
] as const;

const toolDefinitions: readonly McpToolDefinition[] = toolSpecs.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: toToolInputJsonSchema(tool.inputSchemaSource),
}));

const toolSpecsByName: ReadonlyMap<VoratiqMcpToolName, ToolSpec> = new Map(
  toolSpecs.map((tool) => [tool.name, tool]),
);

export function getVoratiqMcpToolDefinitions(): readonly McpToolDefinition[] {
  return toolDefinitions;
}

export function createVoratiqMcpRequestHandler(
  options: CreateVoratiqMcpRequestHandlerOptions = {},
): {
  handleRequest: (message: JsonRpcRequestMessage) => Promise<JsonRpcResponse>;
  handleNotification: (
    message: JsonRpcNotificationMessage,
  ) => Promise<void> | void;
} {
  const invokeCliJsonContract = options.invokeCliJsonContract;
  const serverVersion = options.serverVersion ?? getVoratiqVersion();
  let hasInitialized = false;

  return {
    async handleRequest(message): Promise<JsonRpcResponse> {
      if (message.method === "initialize") {
        if (hasInitialized) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INVALID_REQUEST,
            "Server is already initialized.",
          );
        }

        const parsedParams = initializeRequestParamsSchema.safeParse(
          message.params ?? {},
        );
        if (!parsedParams.success) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INVALID_PARAMS,
            "Invalid initialize params.",
            {
              validation: z.flattenError(parsedParams.error),
            },
          );
        }

        if (
          parsedParams.data.protocolVersion !== VORATIQ_MCP_PROTOCOL_VERSION
        ) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INVALID_PARAMS,
            "Unsupported MCP protocol version.",
            {
              expectedProtocolVersion: VORATIQ_MCP_PROTOCOL_VERSION,
              receivedProtocolVersion: parsedParams.data.protocolVersion,
            },
          );
        }

        hasInitialized = true;
        return createSuccessResponse(message.id, {
          protocolVersion: VORATIQ_MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "voratiq",
            version: serverVersion,
          },
        });
      }

      if (!hasInitialized) {
        return createErrorResponse(
          message.id,
          JSON_RPC_INVALID_REQUEST,
          "Server not initialized.",
        );
      }

      if (message.method === "ping") {
        return createSuccessResponse(message.id, {});
      }

      if (message.method === "tools/list") {
        return createSuccessResponse(message.id, {
          tools: getVoratiqMcpToolDefinitions(),
        });
      }

      if (message.method === "tools/call") {
        const parsed = callToolParamsSchema.safeParse(message.params ?? {});
        if (!parsed.success) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INVALID_PARAMS,
            "Invalid tools/call params.",
            {
              validation: z.flattenError(parsed.error),
            },
          );
        }

        const toolName = parsed.data.name as VoratiqMcpToolName;
        const tool = toolSpecsByName.get(toolName);
        if (!tool) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INVALID_PARAMS,
            `Unknown tool: ${parsed.data.name}`,
          );
        }
        if (!invokeCliJsonContract) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INTERNAL_ERROR,
            "No CLI invocation bridge configured for MCP tool execution.",
          );
        }

        const result = await executeToolCall({
          tool,
          rawInput: parsed.data.arguments ?? {},
          invokeCliJsonContract,
        });
        return createSuccessResponse(message.id, result);
      }

      return createErrorResponse(
        message.id,
        JSON_RPC_METHOD_NOT_FOUND,
        `Method not found: ${message.method}`,
      );
    },

    handleNotification(message): void {
      if (message.method === "notifications/initialized") {
        return;
      }
    },
  };
}

export interface RunVoratiqMcpStdioServerOptions {
  stdin?: McpInputStream;
  stdout?: McpOutputStream;
  invokeCliJsonContract?: InvokeCliJsonContract;
  selfCliTarget?: VoratiqCliTarget;
  serverVersion?: string;
}

interface McpInputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  resume(): void;
}

interface McpOutputStream {
  write(chunk: string | Buffer): boolean;
}

export async function runVoratiqMcpStdioServer(
  options: RunVoratiqMcpStdioServerOptions = {},
): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const invokeCliJsonContract =
    options.invokeCliJsonContract ??
    createDefaultCliJsonContractInvoker(
      options.selfCliTarget ?? resolveVoratiqCliTarget(),
    );
  const requestHandler = createVoratiqMcpRequestHandler({
    invokeCliJsonContract,
    serverVersion: options.serverVersion,
  });

  let buffer = Buffer.alloc(0);
  const pendingPayloads: string[] = [];
  let isDraining = false;
  let hasEnded = false;

  await new Promise<void>((resolve, reject) => {
    const tryResolve = (): void => {
      if (!hasEnded) {
        return;
      }
      if (isDraining) {
        return;
      }
      if (pendingPayloads.length > 0) {
        return;
      }
      resolve();
    };

    const drainQueue = (): void => {
      if (isDraining) {
        return;
      }

      isDraining = true;
      void (async () => {
        while (pendingPayloads.length > 0) {
          const payload = pendingPayloads.shift();
          if (payload === undefined) {
            continue;
          }

          try {
            const parsed = JSON.parse(payload) as unknown;
            const message = normalizeIncomingMessage(parsed);
            if (!message) {
              writeFramedMessage(
                stdout,
                createErrorResponse(
                  null,
                  JSON_RPC_INVALID_REQUEST,
                  "Invalid JSON-RPC message.",
                ),
              );
              continue;
            }

            if ("id" in message) {
              const response = await requestHandler.handleRequest(message);
              writeFramedMessage(stdout, response);
              continue;
            }

            await requestHandler.handleNotification(message);
          } catch (error) {
            if (error instanceof SyntaxError) {
              writeFramedMessage(
                stdout,
                createErrorResponse(
                  null,
                  JSON_RPC_PARSE_ERROR,
                  "Failed to parse JSON-RPC payload.",
                  { message: error.message },
                ),
              );
              continue;
            }

            writeFramedMessage(
              stdout,
              createErrorResponse(
                null,
                JSON_RPC_INTERNAL_ERROR,
                "Unhandled MCP server error.",
                {
                  message: toErrorMessage(error),
                },
              ),
            );
          }
        }
        isDraining = false;
        tryResolve();
      })();
    };

    stdin.on("data", (chunk: Buffer | string) => {
      buffer = Buffer.concat([buffer, toBuffer(chunk)]);

      while (true) {
        const headerEnd = buffer.indexOf(HEADER_DELIMITER);
        if (headerEnd < 0) {
          break;
        }

        const headerBlock = buffer.subarray(0, headerEnd).toString("utf8");
        const contentLength = parseContentLength(headerBlock);
        if (contentLength === null) {
          writeFramedMessage(
            stdout,
            createErrorResponse(
              null,
              JSON_RPC_INVALID_REQUEST,
              "Missing or invalid Content-Length header.",
            ),
          );
          buffer = Buffer.alloc(0);
          break;
        }

        const messageStart = headerEnd + HEADER_DELIMITER.length;
        const messageEnd = messageStart + contentLength;
        if (buffer.length < messageEnd) {
          break;
        }

        const payload = buffer.subarray(messageStart, messageEnd).toString();
        pendingPayloads.push(payload);
        buffer = buffer.subarray(messageEnd);
      }

      drainQueue();
    });

    stdin.on("end", () => {
      hasEnded = true;
      tryResolve();
    });

    stdin.on("error", (error) => {
      reject(error);
    });

    stdin.resume();
  });
}

async function executeToolCall(options: {
  tool: ToolSpec;
  rawInput: unknown;
  invokeCliJsonContract: InvokeCliJsonContract;
}): Promise<CallToolResult> {
  const { tool, rawInput, invokeCliJsonContract } = options;

  const parsedInput = tool.inputSchemaSource.safeParse(rawInput);
  if (!parsedInput.success) {
    return buildTransportFailureCallResult({
      failureKind: "invalid_input",
      operator: tool.operator,
      message: "Tool input failed schema validation.",
      details: {
        validation: z.flattenError(parsedInput.error),
      },
    });
  }

  const invocation = await invokeCliJsonContract({
    operator: tool.operator,
    args: tool.buildArgs(parsedInput.data),
  });
  if (invocation.kind === "spawn_failed") {
    return buildTransportFailureCallResult({
      failureKind: "spawn_failed",
      operator: tool.operator,
      message: `Failed to start voratiq ${tool.operator} --json.`,
    });
  }

  const payloadText = invocation.stdout.trim();
  if (payloadText.length === 0) {
    return buildTransportFailureCallResult({
      failureKind: "malformed_json",
      operator: tool.operator,
      message: "CLI did not emit JSON output.",
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    return buildTransportFailureCallResult({
      failureKind: "malformed_json",
      operator: tool.operator,
      message: "CLI emitted malformed JSON.",
      details: {
        message: toErrorMessage(error),
      },
    });
  }

  if (tool.outputContract === "execution") {
    const envelopeResult = operatorResultEnvelopeSchema.safeParse(payload);
    if (!envelopeResult.success) {
      return buildTransportFailureCallResult({
        failureKind: "contract_mismatch",
        operator: tool.operator,
        message: "CLI JSON did not match OperatorResultEnvelope.",
        details: {
          expectedContractType: "OperatorResultEnvelope",
          validation: z.flattenError(envelopeResult.error),
        },
      });
    }

    const envelope = envelopeResult.data as OperatorResultEnvelope;
    const isError = envelope.status === "failed" || invocation.exitCode !== 0;
    return buildCallToolResult(envelope, isError);
  }

  const listResult = listJsonOutputSchema.safeParse(payload);
  if (!listResult.success) {
    return buildTransportFailureCallResult({
      failureKind: "contract_mismatch",
      operator: tool.operator,
      message: "CLI JSON did not match ListJsonOutput.",
      details: {
        expectedContractType: "ListJsonOutput",
        validation: z.flattenError(listResult.error),
      },
    });
  }

  const listOutput = listResult.data as ListJsonOutput;
  const isError = invocation.exitCode !== 0;
  return buildCallToolResult(listOutput, isError);
}

function buildCallToolResult(
  payload: unknown,
  isError: boolean,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
    isError,
  };
}

function buildTransportFailureCallResult(
  payload: TransportFailureResult,
): CallToolResult {
  return buildCallToolResult(payload, true);
}

function buildSpecExecutionArgs(input: ExternalSpecExecutionInput): string[] {
  const args = ["spec", "--description", input.description];
  appendRepeatedStringFlag(args, "--agent", input.agentIds);
  appendOptionalStringFlag(args, "--profile", input.profile);
  appendOptionalNumberFlag(args, "--max-parallel", input.maxParallel);
  appendOptionalStringFlag(args, "--title", input.title);
  appendRepeatedStringFlag(args, "--extra-context", input.extraContext);
  args.push("--json");
  return args;
}

function buildRunExecutionArgs(input: ExternalRunExecutionInput): string[] {
  const args = ["run", "--spec", input.specPath];
  appendRepeatedStringFlag(args, "--agent", input.agentIds);
  appendOptionalStringFlag(args, "--profile", input.profile);
  appendOptionalNumberFlag(args, "--max-parallel", input.maxParallel);
  appendOptionalTrueFlag(args, "--branch", input.branch);
  appendRepeatedStringFlag(args, "--extra-context", input.extraContext);
  args.push("--json");
  return args;
}

function buildReduceExecutionArgs(
  input: ExternalReduceExecutionInput,
): string[] {
  const args = ["reduce", `--${input.target.type}`, input.target.id];
  appendRepeatedStringFlag(args, "--agent", input.agentIds);
  appendOptionalStringFlag(args, "--profile", input.profile);
  appendOptionalNumberFlag(args, "--max-parallel", input.maxParallel);
  appendRepeatedStringFlag(args, "--extra-context", input.extraContext);
  args.push("--json");
  return args;
}

function buildVerifyExecutionArgs(
  input: ExternalVerifyExecutionInput,
): string[] {
  const args = ["verify", `--${input.target.kind}`, input.target.sessionId];
  appendRepeatedStringFlag(args, "--agent", input.agentIds);
  appendOptionalStringFlag(args, "--profile", input.profile);
  appendOptionalNumberFlag(args, "--max-parallel", input.maxParallel);
  appendRepeatedStringFlag(args, "--extra-context", input.extraContext);
  args.push("--json");
  return args;
}

function buildApplyExecutionArgs(input: ExternalApplyExecutionInput): string[] {
  const args = ["apply", "--run", input.runId, "--agent", input.agentId];
  appendOptionalTrueFlag(
    args,
    "--ignore-base-mismatch",
    input.ignoreBaseMismatch,
  );
  appendOptionalTrueFlag(args, "--commit", input.commit);
  args.push("--json");
  return args;
}

function buildPruneExecutionArgs(input: ExternalPruneExecutionInput): string[] {
  const args =
    input.scope === "all"
      ? ["prune", "--all"]
      : ["prune", "--run", input.runId];
  appendOptionalTrueFlag(args, "--purge", input.purge);
  args.push("--yes", "--json");
  return args;
}

function buildListInspectionArgs(input: ExternalListInspectionInput): string[] {
  const args = ["list", `--${input.operator}`];
  if (input.mode === "detail") {
    args.push(input.sessionId);
  }
  appendOptionalTrueFlag(args, "--verbose", input.verbose);
  appendOptionalNumberFlag(args, "--limit", input.limit);
  args.push("--json");
  return args;
}

function appendRepeatedStringFlag(
  args: string[],
  flag: string,
  values: readonly string[] | undefined,
): void {
  for (const value of values ?? []) {
    args.push(flag, value);
  }
}

function appendOptionalStringFlag(
  args: string[],
  flag: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    args.push(flag, value);
  }
}

function appendOptionalNumberFlag(
  args: string[],
  flag: string,
  value: number | undefined,
): void {
  if (value !== undefined) {
    args.push(flag, String(value));
  }
}

function appendOptionalTrueFlag(
  args: string[],
  flag: string,
  enabled: boolean | undefined,
): void {
  if (enabled === true) {
    args.push(flag);
  }
}

interface VoratiqCliTarget {
  command: string;
  argsPrefix: string[];
}

export function createEntrypointCliTarget(input: {
  cliEntrypoint: string | undefined;
  nodeExecutable?: string;
}): VoratiqCliTarget | undefined {
  const { cliEntrypoint, nodeExecutable = process.execPath } = input;
  if (!cliEntrypoint || cliEntrypoint.length === 0) {
    return undefined;
  }

  return {
    command: nodeExecutable,
    argsPrefix: [cliEntrypoint],
  };
}

export function resolveVoratiqCliTarget(): VoratiqCliTarget {
  const installedBinary = detectBinary("voratiq");
  if (installedBinary) {
    return {
      command: installedBinary,
      argsPrefix: [],
    };
  }

  return {
    command: "voratiq",
    argsPrefix: [],
  };
}

export function createDefaultCliJsonContractInvoker(
  target: VoratiqCliTarget = resolveVoratiqCliTarget(),
): InvokeCliJsonContract {
  return async (input) =>
    await invokeSubprocess({
      command: target.command,
      args: [...target.argsPrefix, ...input.args],
    });
}

async function invokeSubprocess(options: {
  command: string;
  args: string[];
}): Promise<CliInvocationResult> {
  return await new Promise<CliInvocationResult>((resolve) => {
    let settled = false;
    const child = spawn(options.command, options.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        kind: "spawn_failed",
        error,
      });
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        kind: "success",
        exitCode: code ?? 0,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      });
    });
  });
}

function toToolInputJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    io: "input",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function createSuccessResponse(
  id: number | string | null,
  result: unknown,
): JsonRpcSuccessResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

function createErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function normalizeIncomingMessage(
  input: unknown,
): JsonRpcIncomingMessage | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  if (input.jsonrpc !== JSON_RPC_VERSION) {
    return undefined;
  }
  if (typeof input.method !== "string" || input.method.length === 0) {
    return undefined;
  }

  if ("id" in input) {
    const id = input.id;
    if (id !== null && typeof id !== "string" && typeof id !== "number") {
      return undefined;
    }
    return {
      jsonrpc: JSON_RPC_VERSION,
      method: input.method,
      id,
      params: input.params,
    };
  }

  return {
    jsonrpc: JSON_RPC_VERSION,
    method: input.method,
    params: input.params,
  };
}

function parseContentLength(headerBlock: string): number | null {
  const lines = headerBlock.split("\r\n");
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    if (key !== "content-length") {
      continue;
    }
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!/^\d+$/u.test(rawValue)) {
      return null;
    }
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < 0) {
      return null;
    }
    return value;
  }
  return null;
}

function writeFramedMessage(
  stdout: McpOutputStream,
  message: JsonRpcResponse,
): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`);
  stdout.write(Buffer.concat([header, payload]));
}

function toBuffer(chunk: Buffer | string): Buffer {
  return typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
