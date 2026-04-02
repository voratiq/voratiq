import { z } from "zod";

import type { ReductionTarget } from "../domain/reduce/model/types.js";
import type { SelectionDecision } from "../policy/index.js";
import type {
  ReductionStatus,
  RunStatus,
  VerificationStatus,
} from "../status/index.js";
import {
  getReductionSessionDirectoryPath,
  getRunDirectoryPath,
  getSpecSessionDirectoryPath,
} from "../workspace/structure.js";
import { externalExecutionOperators } from "./contract.js";
import { toCliError } from "./errors.js";

export type EnvelopeOperator = (typeof externalExecutionOperators)[number];

export type EnvelopeStatus = "succeeded" | "failed" | "unresolved";

export interface EnvelopeArtifactRef {
  kind: string;
  path: string;
  role?: string;
  agentId?: string;
}

export interface OperatorResultEnvelope {
  version: 1;
  operator: EnvelopeOperator;
  status: EnvelopeStatus;
  timestamp: string;
  ids?: {
    sessionId?: string;
    runId?: string;
    verificationId?: string;
    reductionId?: string;
    agentId?: string;
  };
  artifacts: EnvelopeArtifactRef[];
  selection?: {
    state: "resolvable" | "unresolved";
    selectedCanonicalAgentId?: string;
    selectedSpecPath?: string;
  };
  unresolvedReasons?: Array<{ code: string; detail?: string }>;
  alerts?: Array<{ level: "info" | "warn" | "error"; message: string }>;
  error?: { code: string; message: string };
}

export const operatorResultEnvelopeSchema = z
  .object({
    version: z.literal(1),
    operator: z.enum(externalExecutionOperators),
    status: z.enum(["succeeded", "failed", "unresolved"]),
    timestamp: z.string(),
    ids: z
      .object({
        sessionId: z.string().optional(),
        runId: z.string().optional(),
        verificationId: z.string().optional(),
        reductionId: z.string().optional(),
        agentId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    artifacts: z.array(
      z
        .object({
          kind: z.string(),
          path: z.string(),
          role: z.string().optional(),
          agentId: z.string().optional(),
        })
        .passthrough(),
    ),
    selection: z
      .object({
        state: z.enum(["resolvable", "unresolved"]),
        selectedCanonicalAgentId: z.string().optional(),
        selectedSpecPath: z.string().optional(),
      })
      .passthrough()
      .optional(),
    unresolvedReasons: z
      .array(
        z
          .object({
            code: z.string(),
            detail: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    alerts: z
      .array(
        z
          .object({
            level: z.enum(["info", "warn", "error"]),
            message: z.string(),
          })
          .passthrough(),
      )
      .optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface VerifyEnvelopeInput {
  verificationId: string;
  target: {
    kind: "spec" | "run" | "reduce";
    sessionId: string;
  };
  outputPath: string;
  status: VerificationStatus;
  selection?: SelectionDecision;
  selectedSpecPath?: string;
  warningMessage?: string;
}

export interface ReduceEnvelopeInput {
  reductionId: string;
  target: ReductionTarget;
  status: ReductionStatus;
}

export interface ApplyEnvelopeInput {
  runId: string;
  agentId: string;
  diffPath: string;
  ignoredBaseMismatch: boolean;
}

export interface PruneEnvelopeInput {
  status: "pruned" | "noop" | "aborted";
  runId?: string;
  runPath?: string;
}

export function buildOperatorEnvelope(options: {
  operator: EnvelopeOperator;
  status: EnvelopeStatus;
  ids?: OperatorResultEnvelope["ids"];
  artifacts?: EnvelopeArtifactRef[];
  selection?: OperatorResultEnvelope["selection"];
  unresolvedReasons?: OperatorResultEnvelope["unresolvedReasons"];
  alerts?: OperatorResultEnvelope["alerts"];
  error?: OperatorResultEnvelope["error"];
  timestamp?: string;
}): OperatorResultEnvelope {
  const envelope: OperatorResultEnvelope = {
    version: 1,
    operator: options.operator,
    status: options.status,
    timestamp: options.timestamp ?? new Date().toISOString(),
    artifacts: options.artifacts ?? [],
  };

  if (options.ids && Object.keys(options.ids).length > 0) {
    envelope.ids = options.ids;
  }
  if (options.selection) {
    envelope.selection = options.selection;
  }
  if (
    options.status === "unresolved" &&
    options.unresolvedReasons &&
    options.unresolvedReasons.length > 0
  ) {
    envelope.unresolvedReasons = options.unresolvedReasons;
  }
  if (options.alerts && options.alerts.length > 0) {
    envelope.alerts = options.alerts;
  }
  if (options.error) {
    envelope.error = options.error;
  }

  return envelope;
}

export function buildFailedOperatorEnvelope(options: {
  operator: EnvelopeOperator;
  error: unknown;
}): OperatorResultEnvelope {
  return buildOperatorEnvelope({
    operator: options.operator,
    status: "failed",
    error: toEnvelopeError(options.error),
  });
}

export function buildSpecOperatorEnvelope(options: {
  sessionId?: string;
  generatedSpecPaths: readonly string[];
}): OperatorResultEnvelope {
  const artifacts: EnvelopeArtifactRef[] = [];
  if (options.sessionId) {
    artifacts.push({
      kind: "session",
      role: "session",
      path: getSpecSessionDirectoryPath(options.sessionId),
    });
  }

  for (const path of options.generatedSpecPaths) {
    artifacts.push({
      kind: "spec",
      role: "candidate",
      path,
      ...withAgentId(
        options.sessionId
          ? getAgentIdFromSessionArtifactPath(path, options.sessionId)
          : undefined,
      ),
    });
  }

  return buildOperatorEnvelope({
    operator: "spec",
    status: "succeeded",
    ids: options.sessionId ? { sessionId: options.sessionId } : undefined,
    artifacts,
  });
}

export function buildRunOperatorEnvelope(options: {
  runId: string;
  specPath: string;
  status: RunStatus;
}): OperatorResultEnvelope {
  return buildOperatorEnvelope({
    operator: "run",
    status: normalizeTerminalStatus(options.status),
    ids: {
      runId: options.runId,
    },
    artifacts: [
      {
        kind: "session",
        role: "session",
        path: getRunDirectoryPath(options.runId),
      },
      {
        kind: "spec",
        role: "input",
        path: options.specPath,
      },
    ],
  });
}

export function buildVerifyOperatorEnvelope(
  options: VerifyEnvelopeInput,
): OperatorResultEnvelope {
  const status =
    options.selection?.state === "unresolved"
      ? "unresolved"
      : normalizeTerminalStatus(options.status);

  const ids: NonNullable<OperatorResultEnvelope["ids"]> = {
    sessionId: options.verificationId,
  };

  if (options.target.kind === "run") {
    ids.runId = options.target.sessionId;
  }
  if (options.target.kind === "reduce") {
    ids.reductionId = options.target.sessionId;
  }

  const alerts: NonNullable<OperatorResultEnvelope["alerts"]> = [];
  if (options.warningMessage) {
    alerts.push({ level: "warn", message: options.warningMessage });
  }
  if (status === "unresolved") {
    alerts.push({
      level: "warn",
      message: "Verification could not resolve a canonical candidate.",
    });
  }

  return buildOperatorEnvelope({
    operator: "verify",
    status,
    ids,
    artifacts: [
      {
        kind: "session",
        role: "session",
        path: options.outputPath,
      },
      ...(options.selectedSpecPath
        ? [
            {
              kind: "spec",
              role: "selected",
              path: options.selectedSpecPath,
            } satisfies EnvelopeArtifactRef,
          ]
        : []),
    ],
    selection: options.selection
      ? {
          state: options.selection.state,
          ...(options.selection.state === "resolvable"
            ? {
                selectedCanonicalAgentId:
                  options.selection.selectedCanonicalAgentId,
              }
            : {}),
          ...(options.selectedSpecPath
            ? { selectedSpecPath: options.selectedSpecPath }
            : {}),
        }
      : undefined,
    unresolvedReasons:
      options.selection?.state === "unresolved"
        ? options.selection.unresolvedReasons.map((reason) => ({
            code: reason.code,
          }))
        : undefined,
    alerts,
  });
}

export function buildReduceOperatorEnvelope(
  options: ReduceEnvelopeInput,
): OperatorResultEnvelope {
  const ids: NonNullable<OperatorResultEnvelope["ids"]> = {
    sessionId: options.reductionId,
  };

  if (options.target.type === "run") {
    ids.runId = options.target.id;
  }
  if (options.target.type === "verify") {
    ids.verificationId = options.target.id;
  }
  if (options.target.type === "reduce") {
    ids.reductionId = options.target.id;
  }

  return buildOperatorEnvelope({
    operator: "reduce",
    status: normalizeTerminalStatus(options.status),
    ids,
    artifacts: [
      {
        kind: "session",
        role: "session",
        path: getReductionSessionDirectoryPath(options.reductionId),
      },
      {
        kind: options.target.type,
        role: "input",
        path: getReductionSourcePath(options.target),
      },
    ],
  });
}

export function buildApplyOperatorEnvelope(
  options: ApplyEnvelopeInput,
): OperatorResultEnvelope {
  return buildOperatorEnvelope({
    operator: "apply",
    status: "succeeded",
    ids: {
      runId: options.runId,
      agentId: options.agentId,
    },
    artifacts: [
      {
        kind: "run",
        role: "target",
        path: getRunDirectoryPath(options.runId),
      },
      {
        kind: "diff",
        role: "output",
        path: options.diffPath,
        agentId: options.agentId,
      },
    ],
    alerts: options.ignoredBaseMismatch
      ? [
          {
            level: "warn",
            message: "Apply proceeded despite a base mismatch.",
          },
        ]
      : undefined,
  });
}

export function buildPruneOperatorEnvelope(
  options: PruneEnvelopeInput,
): OperatorResultEnvelope {
  return buildOperatorEnvelope({
    operator: "prune",
    status:
      options.status === "aborted"
        ? "failed"
        : ("succeeded" satisfies EnvelopeStatus),
    ids: options.runId
      ? {
          runId: options.runId,
        }
      : undefined,
    artifacts: options.runPath
      ? [
          {
            kind: "run",
            role: "target",
            path: options.runPath,
          },
        ]
      : [],
  });
}

export function writeOperatorResultEnvelope(
  envelope: OperatorResultEnvelope,
  exitCode?: number,
): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
  }
}

export function createSilentCliWriter(): Pick<NodeJS.WriteStream, "write"> & {
  isTTY?: boolean;
} {
  return {
    isTTY: false,
    write(): boolean {
      return true;
    },
  };
}

export function resolveJsonEnvelopeOperator(
  argv: readonly string[],
): EnvelopeOperator | undefined {
  if (!argv.includes("--json")) {
    return undefined;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return undefined;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    return undefined;
  }

  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry || entry === "--") {
      continue;
    }
    if (entry.startsWith("-")) {
      continue;
    }
    if (isEnvelopeOperator(entry)) {
      return entry;
    }
    return undefined;
  }

  return undefined;
}

function isEnvelopeOperator(value: string): value is EnvelopeOperator {
  return externalExecutionOperators.includes(value as EnvelopeOperator);
}

function normalizeTerminalStatus(
  status: RunStatus | VerificationStatus,
): EnvelopeStatus {
  return status === "succeeded" ? "succeeded" : "failed";
}

function toEnvelopeError(error: unknown): {
  code: string;
  message: string;
} {
  const cliError = toCliError(error);
  let code = "command_failed";

  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string") {
      code = normalizeErrorCode(error.code);
    } else if ("name" in error && typeof error.name === "string") {
      code = normalizeErrorCode(error.name);
    }
  }

  return {
    code,
    message: cliError.headline,
  };
}

function normalizeErrorCode(value: string): string {
  const snake = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return snake.length > 0 ? snake : "command_failed";
}

function getReductionSourcePath(target: ReductionTarget): string {
  switch (target.type) {
    case "spec":
      return `.voratiq/spec/sessions/${target.id}`;
    case "run":
      return `.voratiq/run/sessions/${target.id}`;
    case "verify":
      return `.voratiq/verify/sessions/${target.id}`;
    case "reduce":
      return `.voratiq/reduce/sessions/${target.id}`;
  }
}

function getAgentIdFromSessionArtifactPath(
  path: string,
  sessionId: string,
): string | undefined {
  const parts = path.split("/");
  const sessionIndex = parts.lastIndexOf(sessionId);
  const candidate = sessionIndex >= 0 ? parts[sessionIndex + 1] : undefined;
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function withAgentId(
  agentId: string | undefined,
): Partial<Pick<EnvelopeArtifactRef, "agentId">> {
  return agentId ? { agentId } : {};
}
