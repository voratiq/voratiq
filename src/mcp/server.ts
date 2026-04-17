import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { z } from "zod";

import {
  type ExternalApplyExecutionInput,
  externalApplyExecutionInputSchema,
  externalInspectionOperatorSchema,
  type ExternalMessageExecutionInput,
  externalMessageExecutionInputSchema,
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
  buildSwarmSessionAcknowledgementEnvelope,
  type OperatorResultEnvelope,
  operatorResultEnvelopeSchema,
} from "../cli/operator-envelope.js";
import {
  listJsonModes,
  listJsonModeSchema,
  type ListJsonOutput,
  listJsonOutputSchema,
} from "../contracts/list.js";
import {
  VORATIQ_MCP_ACK_OPERATOR_ENV,
  VORATIQ_MCP_ACK_PATH_ENV,
} from "../utils/swarm-session-ack.js";
import { getVoratiqVersion } from "../utils/version.js";
import {
  createEntrypointVoratiqCliTarget as createEntrypointCliTarget,
  resolveVoratiqCliTarget,
  type VoratiqCliTarget,
} from "../utils/voratiq-cli-target.js";

const JSON_RPC_VERSION = "2.0" as const;
const HEADER_DELIMITER = Buffer.from("\r\n\r\n", "utf8");
const LF_HEADER_DELIMITER = Buffer.from("\n\n", "utf8");

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;
const SWARM_EARLY_ACK_TIMEOUT_MS = 15_000;
const SWARM_EARLY_ACK_POLL_INTERVAL_MS = 100;

export const VORATIQ_MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const VORATIQ_SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  VORATIQ_MCP_PROTOCOL_VERSION,
  "2025-06-18",
  "2024-11-05",
] as const;

function isSupportedMcpProtocolVersion(
  protocolVersion: string,
): protocolVersion is (typeof VORATIQ_SUPPORTED_MCP_PROTOCOL_VERSIONS)[number] {
  return (
    VORATIQ_SUPPORTED_MCP_PROTOCOL_VERSIONS as readonly string[]
  ).includes(protocolVersion);
}

export type VoratiqMcpExecutionToolName =
  | "voratiq_spec"
  | "voratiq_run"
  | "voratiq_reduce"
  | "voratiq_verify"
  | "voratiq_message"
  | "voratiq_apply"
  | "voratiq_prune";

export type VoratiqMcpToolName = VoratiqMcpExecutionToolName | "voratiq_list";

export type VoratiqMcpOperator =
  | "spec"
  | "run"
  | "reduce"
  | "verify"
  | "message"
  | "apply"
  | "list"
  | "prune";

type SwarmExecutionOperator = "spec" | "run" | "reduce" | "verify" | "message";

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
  readonly mcpInputSchema?: Record<string, unknown>;
  readonly buildArgs: (input: unknown) => string[];
  readonly outputContract: "execution" | "list";
}

const mcpListInspectionInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      operator: externalInspectionOperatorSchema,
      mode: z.literal(listJsonModes[0]),
      verbose: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      operator: externalInspectionOperatorSchema,
      mode: z.literal(listJsonModes[1]),
      sessionId: z.string().min(1),
      verbose: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict(),
]);

type McpListInspectionInput = z.infer<typeof mcpListInspectionInputSchema>;

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

interface JsonRpcNotificationResponse {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

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
      "Draft or refine a Voratiq spec session from a task description, an existing spec, or related repo context.",
    inputSchemaSource: externalSpecExecutionInputSchema,
    buildArgs: (input) =>
      buildSpecExecutionArgs(input as ExternalSpecExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_run",
    operator: "run",
    description:
      "Execute a Voratiq spec session and create a run with agent outputs and artifacts.",
    inputSchemaSource: externalRunExecutionInputSchema,
    buildArgs: (input) =>
      buildRunExecutionArgs(input as ExternalRunExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_reduce",
    operator: "reduce",
    description:
      "Reduce a set of Voratiq artifacts into a summarized output for comparison or follow-on work.",
    inputSchemaSource: externalReduceExecutionInputSchema,
    buildArgs: (input) =>
      buildReduceExecutionArgs(input as ExternalReduceExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_verify",
    operator: "verify",
    description:
      "Verify a Voratiq spec, run, reduction, or message session and record the evaluation result.",
    inputSchemaSource: externalVerifyExecutionInputSchema,
    buildArgs: (input) =>
      buildVerifyExecutionArgs(input as ExternalVerifyExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_message",
    operator: "message",
    description:
      "Send an isolated prompt to one or more Voratiq agents and persist their independent replies as a recorded message session.",
    inputSchemaSource: externalMessageExecutionInputSchema,
    buildArgs: (input) =>
      buildMessageExecutionArgs(input as ExternalMessageExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_apply",
    operator: "apply",
    description:
      "Apply an accepted Voratiq run diff into the current working tree.",
    inputSchemaSource: externalApplyExecutionInputSchema,
    buildArgs: (input) =>
      buildApplyExecutionArgs(input as ExternalApplyExecutionInput),
    outputContract: "execution",
  },
  {
    name: "voratiq_list",
    operator: "list",
    description:
      "List recorded Voratiq sessions for one operator (`spec`, `run`, `reduce`, `verify`, `message`, or `interactive`) in list or detail mode.",
    inputSchemaSource: mcpListInspectionInputSchema,
    mcpInputSchema: createListMcpInputSchema(),
    buildArgs: (input) =>
      buildListInspectionArgs(input as McpListInspectionInput),
    outputContract: "list",
  },
  {
    name: "voratiq_prune",
    operator: "prune",
    description:
      "Prune Voratiq run workspaces or all pruneable run state after confirmation.",
    inputSchemaSource: externalPruneExecutionInputSchema,
    mcpInputSchema: createPruneMcpInputSchema(),
    buildArgs: (input) =>
      buildPruneExecutionArgs(input as ExternalPruneExecutionInput),
    outputContract: "execution",
  },
] as const;

const toolDefinitions: readonly McpToolDefinition[] = toolSpecs.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema:
    tool.mcpInputSchema ?? toToolInputJsonSchema(tool.inputSchemaSource),
}));

export const VORATIQ_GUIDE_RESOURCE_URI = "voratiq://guide" as const;

const VORATIQ_GUIDE_RESOURCE_CONTENT = `# Voratiq Operator Guide

Voratiq is a workflow system built around composable operators that launch, evaluate, and manage multi-agent work against a repository. It gives interactive agents a structured way to delegate coding tasks, inspect recorded state, verify outcomes, and apply accepted changes without doing all of that inline.

## Operator Classes

Voratiq operators fall into two main classes:

- **Swarm operators** dispatch agents to produce, synthesize, or evaluate work: spec, run, reduce, verify, message
- **Control operators** inspect state or mutate accepted outcomes: apply, list, prune

## Swarm Operators

**spec** – Drafts or refines a specification for a task from a description, an existing spec, or related repository context. Launches one or more spec agents and records their outputs as a spec session.

**run** – Executes a spec session by launching run agents that read the spec, work against a sandboxed workspace, and produce artifacts including diffs and transcripts. Records a run session.

**reduce** – Summarizes artifacts from a spec, run, or message session into a single reduced output suitable for comparison or follow-on work. Records a reduce session.

**verify** – Evaluates a spec, run, reduction, or message session and records a structured verdict. This is Voratiq's main decision operator: use it to compare outputs, choose stronger candidates, and decide whether work should be applied, inspected further, rerun, or redirected.

**message** – Sends an isolated prompt to one or more agents and persists each reply independently as a message session. Use for standalone questions, reviews, or exploration that does not require a full spec/run workflow.

## Control Operators

**list** – Lists or inspects recorded sessions for a given operator. This is the primary way to inspect swarm sessions; use it to poll progress, retrieve session IDs, and inspect recorded workflow state.

**apply** – Applies an accepted run diff into the current working tree. Synchronous and non-durable; only invoke after verifying that the target run is in an acceptable state.

**prune** – Removes pruneable run workspaces or all pruneable state. Synchronous and non-durable; requires explicit confirmation.

## Workflow Composition

Operators compose into many workflow shapes rather than one required path. Common patterns include: using message for standalone exploration or review; using spec → verify to compare candidate specs before execution; using spec → run when a task needs structured execution; using run → verify to choose among competing implementations; using reduce when multiple outputs need synthesis before a decision; and using verify whenever a workflow needs a structured recommendation instead of ad hoc judgment. The list operator can be called at any point to inspect recorded state across all operators.

## Swarm Session Behavior

The five swarm operators are spec, run, reduce, verify, and message. Each one creates a recorded session and may return before the session is finished. Once a session has been created, treat that session as the unit of work. A returned sessionId means the work has been launched, not completed. Use voratiq_list to inspect active sessions.

## Status Interpretation

Session status is primary; recipient status is supporting detail.

- **queued** means the session has been accepted and recorded but its work has not started yet.
- **running** means the session is active and remains the canonical in-flight unit of work.
- **succeeded** means the session reached a successful terminal state; inspect its outputs and decide what should happen next.
- **failed** means the session reached a terminal failure state.
- **unresolved** means the session reached a terminal state without a clear winner or confident decision.

Mixed recipient states do not imply session failure. Some recipients may fail while others continue running, and the session remains active until its session status becomes terminal.

## extraContext Contract

The extraContext field accepts an array of file paths pointing to additional readable files staged alongside the operator workspace. Pass file paths only — not raw text content, and not paths to files that operators already see by default (such as standard repository context). Passing raw content or redundant paths increases token usage without providing new information.

## maxParallel Semantics

The maxParallel field controls the maximum number of agent recipients running in parallel for an operator invocation. Set it deliberately: it directly affects cost and latency. Higher values increase concurrency but also increase total token expenditure and can create contention. Do not treat maxParallel as a free dial to increase throughput without modeling the downstream cost and latency impact.

## Key Discipline Rules

Commit to one workflow objective per session; do not interleave unrelated operator calls in the same sequence. Wait for stage boundaries before acting on results: read voratiq_list output before proceeding from one stage to the next. Use voratiq_list as the primary control plane for inspecting recorded state rather than reading session files directly.` as const;

const VORATIQ_MCP_SERVER_INSTRUCTIONS =
  "Voratiq tools operate on Voratiq workflow state in the current repository. Use voratiq_list for questions about recent or specific spec, run, reduce, verify, message, or interactive sessions. The swarm operators (voratiq_spec, voratiq_run, voratiq_reduce, voratiq_verify, voratiq_message) create recorded sessions and may acknowledge before finishing; once launched, treat the session as the unit of work. If a swarm call times out or returns a non-terminal status, inspect progress with voratiq_list instead of retrying. Use voratiq_apply and voratiq_prune for synchronous control actions. Prefer these tools over shell inspection when the task is about Voratiq workflow history or state." as const;

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

        if (!isSupportedMcpProtocolVersion(parsedParams.data.protocolVersion)) {
          return createErrorResponse(
            message.id,
            JSON_RPC_INVALID_PARAMS,
            "Unsupported MCP protocol version.",
            {
              expectedProtocolVersion: VORATIQ_MCP_PROTOCOL_VERSION,
              supportedProtocolVersions: [
                ...VORATIQ_SUPPORTED_MCP_PROTOCOL_VERSIONS,
              ],
              receivedProtocolVersion: parsedParams.data.protocolVersion,
            },
          );
        }

        hasInitialized = true;
        return createSuccessResponse(message.id, {
          protocolVersion: parsedParams.data.protocolVersion,
          capabilities: {
            tools: {
              listChanged: true,
            },
            resources: {},
          },
          instructions: VORATIQ_MCP_SERVER_INSTRUCTIONS,
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

      if (message.method === "resources/list") {
        return createSuccessResponse(message.id, {
          resources: [
            {
              uri: VORATIQ_GUIDE_RESOURCE_URI,
              name: "Voratiq Operator Guide",
              description:
                "Complete reference for Voratiq operators, workflow composition, swarm-session behavior, extraContext contract, and maxParallel semantics.",
              mimeType: "text/plain",
            },
          ],
        });
      }

      if (message.method === "resources/read") {
        const uri = isRecord(message.params) ? message.params.uri : undefined;
        if (uri === VORATIQ_GUIDE_RESOURCE_URI) {
          return createSuccessResponse(message.id, {
            contents: [
              {
                uri: VORATIQ_GUIDE_RESOURCE_URI,
                mimeType: "text/plain",
                text: VORATIQ_GUIDE_RESOURCE_CONTENT,
              },
            ],
          });
        }
        return createErrorResponse(
          message.id,
          JSON_RPC_INVALID_PARAMS,
          `Unknown resource URI: ${String(uri)}`,
        );
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

type McpTransportEncoding = "framed" | "jsonl";

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
  const pendingPayloads: Array<{
    payload: string;
    transportEncoding: McpTransportEncoding;
  }> = [];
  let isDraining = false;
  let hasEnded = false;
  let inFlightHandlers = 0;
  let hasCompletedInitialize = false;
  let transportEncoding: McpTransportEncoding = "framed";
  let writeChain = Promise.resolve();

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
      if (inFlightHandlers > 0) {
        return;
      }
      resolve();
    };

    const writeMessageSerialized = (
      outputEncoding: McpTransportEncoding,
      message: JsonRpcResponse | JsonRpcNotificationResponse,
    ): Promise<void> => {
      writeChain = writeChain.then(() => {
        writeMessage(stdout, outputEncoding, message);
      });
      return writeChain;
    };

    const handlePayload = async (
      payload: string,
      outputEncoding: McpTransportEncoding,
    ): Promise<void> => {
      try {
        const parsed = JSON.parse(payload) as unknown;
        const message = normalizeIncomingMessage(parsed);
        if (!message) {
          await writeMessageSerialized(
            outputEncoding,
            createErrorResponse(
              null,
              JSON_RPC_INVALID_REQUEST,
              "Invalid JSON-RPC message.",
            ),
          );
          return;
        }

        if ("id" in message) {
          const response = await requestHandler.handleRequest(message);
          await writeMessageSerialized(outputEncoding, response);
          if (message.method === "initialize" && !("error" in response)) {
            hasCompletedInitialize = true;
            await writeMessageSerialized(
              outputEncoding,
              createNotification("notifications/tools/list_changed"),
            );
          }
          return;
        }

        await requestHandler.handleNotification(message);
      } catch (error) {
        if (error instanceof SyntaxError) {
          await writeMessageSerialized(
            outputEncoding,
            createErrorResponse(
              null,
              JSON_RPC_PARSE_ERROR,
              "Failed to parse JSON-RPC payload.",
              { message: error.message },
            ),
          );
          return;
        }

        await writeMessageSerialized(
          outputEncoding,
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
    };

    const dispatchPayload = (
      payload: string,
      outputEncoding: McpTransportEncoding,
    ): Promise<void> => {
      inFlightHandlers += 1;
      return handlePayload(payload, outputEncoding).finally(() => {
        inFlightHandlers -= 1;
        tryResolve();
      });
    };

    const drainQueue = (): void => {
      if (isDraining) {
        return;
      }

      isDraining = true;
      void (async () => {
        while (pendingPayloads.length > 0) {
          const queued = pendingPayloads.shift();
          if (queued === undefined) {
            continue;
          }

          if (!hasCompletedInitialize) {
            await dispatchPayload(queued.payload, queued.transportEncoding);
            continue;
          }

          void dispatchPayload(queued.payload, queued.transportEncoding);
        }
        isDraining = false;
        tryResolve();
      })();
    };

    stdin.on("data", (chunk: Buffer | string) => {
      buffer = Buffer.concat([buffer, toBuffer(chunk)]);

      while (true) {
        const extracted = extractNextPayload(buffer, transportEncoding);
        if (!extracted) {
          break;
        }

        if (extracted.kind === "invalid") {
          writeMessage(
            stdout,
            transportEncoding,
            createErrorResponse(
              null,
              JSON_RPC_INVALID_REQUEST,
              extracted.message,
            ),
          );
          buffer = Buffer.alloc(0);
          break;
        }

        transportEncoding = extracted.transportEncoding;
        pendingPayloads.push({
          payload: extracted.payload,
          transportEncoding,
        });
        buffer = Buffer.from(extracted.remaining);
      }

      drainQueue();
    });

    stdin.on("end", () => {
      const trailingPayload = extractTrailingJsonLine(buffer);
      if (trailingPayload) {
        transportEncoding = "jsonl";
        pendingPayloads.push({
          payload: trailingPayload,
          transportEncoding,
        });
        buffer = Buffer.alloc(0);
        drainQueue();
      }
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

function createNotification(
  method: string,
  params?: unknown,
): JsonRpcNotificationResponse {
  return params === undefined
    ? {
        jsonrpc: JSON_RPC_VERSION,
        method,
      }
    : {
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
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

function buildMessageExecutionArgs(
  input: ExternalMessageExecutionInput,
): string[] {
  const args = ["message", "--prompt", input.prompt];
  appendRepeatedStringFlag(args, "--agent", input.agentIds);
  appendOptionalStringFlag(args, "--profile", input.profile);
  appendOptionalNumberFlag(args, "--max-parallel", input.maxParallel);
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

function buildListInspectionArgs(input: McpListInspectionInput): string[] {
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

export { createEntrypointCliTarget, resolveVoratiqCliTarget };

export function createDefaultCliJsonContractInvoker(
  target: VoratiqCliTarget = resolveVoratiqCliTarget(),
): InvokeCliJsonContract {
  return async (input) => {
    if (isSwarmExecutionOperator(input.operator)) {
      return await invokeSwarmSubprocessWithEarlyAck({
        command: target.command,
        args: [...target.argsPrefix, ...input.args],
        operator: input.operator,
        cwd: process.cwd(),
      });
    }

    return await invokeSubprocess({
      command: target.command,
      args: [...target.argsPrefix, ...input.args],
    });
  };
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

async function invokeSwarmSubprocessWithEarlyAck(options: {
  command: string;
  args: string[];
  operator: SwarmExecutionOperator;
  cwd: string;
}): Promise<CliInvocationResult> {
  const ackDir = await mkdtemp(join(tmpdir(), "voratiq-mcp-ack-"));
  const ackPath = join(ackDir, "ack.json");

  return await new Promise<CliInvocationResult>((resolve) => {
    let settled = false;
    let shouldBufferOutput = true;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        [VORATIQ_MCP_ACK_PATH_ENV]: ackPath,
        [VORATIQ_MCP_ACK_OPERATOR_ENV]: options.operator,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const settle = (result: CliInvocationResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      void rm(ackDir, { recursive: true, force: true }).catch(() => {});
      resolve(result);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      if (shouldBufferOutput) {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      if (shouldBufferOutput) {
        stderrChunks.push(chunk);
      }
    });

    child.once("error", (error) => {
      settle({
        kind: "spawn_failed",
        error,
      });
    });

    child.once("close", (code) => {
      settle({
        kind: "success",
        exitCode: code ?? 0,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      });
    });

    void waitForSwarmSessionObservation({
      ackPath,
      timeoutMs: SWARM_EARLY_ACK_TIMEOUT_MS,
      pollIntervalMs: SWARM_EARLY_ACK_POLL_INTERVAL_MS,
    })
      .then((observation) => {
        if (!observation) {
          return;
        }

        shouldBufferOutput = false;
        settle({
          kind: "success",
          exitCode: 0,
          stdout: JSON.stringify(
            buildSwarmSessionAcknowledgementEnvelope({
              operator: options.operator,
              sessionId: observation.sessionId,
              status: observation.status,
            }),
          ),
          stderr: "",
        });
      })
      .catch(() => {});
  });
}

function isSwarmExecutionOperator(
  operator: VoratiqMcpOperator,
): operator is SwarmExecutionOperator {
  return (
    operator === "spec" ||
    operator === "run" ||
    operator === "reduce" ||
    operator === "verify" ||
    operator === "message"
  );
}

async function waitForSwarmSessionObservation(options: {
  ackPath: string;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<
  | {
      sessionId: string;
      status: "queued" | "running" | "succeeded" | "failed";
    }
  | undefined
> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    const observation = await readSwarmSessionRecord({
      ackPath: options.ackPath,
    });
    if (observation) {
      return observation;
    }
    await sleep(options.pollIntervalMs);
  }

  return undefined;
}

async function readSwarmSessionRecord(options: { ackPath: string }): Promise<
  | {
      sessionId: string;
      status: "queued" | "running" | "succeeded" | "failed";
    }
  | undefined
> {
  try {
    const raw = await readFile(options.ackPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }

    const sessionId = parsed.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return undefined;
    }

    const status = parsed.status;
    if (
      status !== "queued" &&
      status !== "running" &&
      status !== "succeeded" &&
      status !== "failed"
    ) {
      return undefined;
    }

    return {
      sessionId,
      status,
    };
  } catch (error) {
    if (isMissingPathError(error) || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toToolInputJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    io: "input",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function createPruneMcpInputSchema(): Record<string, unknown> {
  return toToolInputJsonSchema(
    z
      .object({
        scope: z.enum(["run", "all"]),
        runId: z
          .string()
          .min(1)
          .optional()
          .describe("Required when scope is `run`."),
        purge: z.boolean().optional(),
        confirmed: z
          .literal(true)
          .describe("Must be true to confirm prune operations."),
      })
      .strict(),
  );
}

function createListMcpInputSchema(): Record<string, unknown> {
  return toToolInputJsonSchema(
    z
      .object({
        operator: externalInspectionOperatorSchema,
        mode: listJsonModeSchema.describe(
          "Use `detail` only when inspecting a specific session.",
        ),
        sessionId: z
          .string()
          .min(1)
          .optional()
          .describe("Required when mode is `detail`."),
        verbose: z.boolean().optional(),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
  );
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
  const lines = headerBlock.split(/\r?\n/u);
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

function findHeaderDelimiter(
  buffer: Buffer,
): { index: number; delimiter: Buffer } | undefined {
  const crlfIndex = buffer.indexOf(HEADER_DELIMITER);
  const lfIndex = buffer.indexOf(LF_HEADER_DELIMITER);

  if (crlfIndex < 0 && lfIndex < 0) {
    return undefined;
  }
  if (crlfIndex < 0) {
    return {
      index: lfIndex,
      delimiter: LF_HEADER_DELIMITER,
    };
  }
  if (lfIndex < 0 || crlfIndex <= lfIndex) {
    return {
      index: crlfIndex,
      delimiter: HEADER_DELIMITER,
    };
  }
  return {
    index: lfIndex,
    delimiter: LF_HEADER_DELIMITER,
  };
}

function writeMessage(
  stdout: McpOutputStream,
  transportEncoding: McpTransportEncoding,
  message: JsonRpcResponse | JsonRpcNotificationResponse,
): void {
  if (transportEncoding === "jsonl") {
    stdout.write(`${JSON.stringify(message)}\n`);
    return;
  }
  writeFramedMessage(stdout, message);
}

function writeFramedMessage(
  stdout: McpOutputStream,
  message: JsonRpcResponse | JsonRpcNotificationResponse,
): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`);
  stdout.write(Buffer.concat([header, payload]));
}

function extractNextPayload(
  buffer: Buffer,
  currentTransportEncoding: McpTransportEncoding,
):
  | {
      kind: "payload";
      payload: string;
      remaining: Buffer;
      transportEncoding: McpTransportEncoding;
    }
  | {
      kind: "invalid";
      message: string;
    }
  | undefined {
  if (
    currentTransportEncoding === "framed" &&
    (startsWithContentLengthHeader(buffer) || looksLikeFramedTransport(buffer))
  ) {
    return extractFramedPayload(buffer);
  }

  const jsonLinePayload = extractJsonLinePayload(buffer);
  if (jsonLinePayload) {
    return jsonLinePayload;
  }

  if (currentTransportEncoding === "framed") {
    return extractFramedPayload(buffer);
  }

  return undefined;
}

function startsWithContentLengthHeader(buffer: Buffer): boolean {
  const firstLineEnd = buffer.indexOf("\n");
  const firstLine =
    firstLineEnd >= 0
      ? buffer.subarray(0, firstLineEnd).toString("utf8")
      : buffer.toString("utf8");
  return /^content-length\s*:/iu.test(firstLine.trim());
}

function looksLikeFramedTransport(buffer: Buffer): boolean {
  const headerDelimiter = findHeaderDelimiter(buffer);
  if (!headerDelimiter) {
    return false;
  }
  const headerBlock = buffer
    .subarray(0, headerDelimiter.index)
    .toString("utf8");
  return /(^|\r?\n)content-length\s*:/iu.test(headerBlock);
}

function extractFramedPayload(buffer: Buffer):
  | {
      kind: "payload";
      payload: string;
      remaining: Buffer;
      transportEncoding: McpTransportEncoding;
    }
  | {
      kind: "invalid";
      message: string;
    }
  | undefined {
  const headerDelimiter = findHeaderDelimiter(buffer);
  if (!headerDelimiter) {
    return undefined;
  }

  const headerBlock = buffer
    .subarray(0, headerDelimiter.index)
    .toString("utf8");
  const contentLength = parseContentLength(headerBlock);
  if (contentLength === null) {
    return {
      kind: "invalid",
      message: "Missing or invalid Content-Length header.",
    };
  }

  const messageStart = headerDelimiter.index + headerDelimiter.delimiter.length;
  const messageEnd = messageStart + contentLength;
  if (buffer.length < messageEnd) {
    return undefined;
  }

  return {
    kind: "payload",
    payload: buffer.subarray(messageStart, messageEnd).toString("utf8"),
    remaining: buffer.subarray(messageEnd),
    transportEncoding: "framed",
  };
}

function extractJsonLinePayload(buffer: Buffer):
  | {
      kind: "payload";
      payload: string;
      remaining: Buffer;
      transportEncoding: McpTransportEncoding;
    }
  | undefined {
  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex < 0) {
    return undefined;
  }

  const line = buffer
    .subarray(0, newlineIndex)
    .toString("utf8")
    .replace(/\r$/u, "");
  const remaining = buffer.subarray(newlineIndex + 1);
  if (line.trim().length === 0) {
    return extractJsonLinePayload(remaining);
  }

  return {
    kind: "payload",
    payload: line,
    remaining,
    transportEncoding: "jsonl",
  };
}

function extractTrailingJsonLine(buffer: Buffer): string | undefined {
  const payload = buffer.toString("utf8").trim();
  return payload.length > 0 ? payload : undefined;
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
