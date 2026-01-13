import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import { evalSlugSchema, evalStatusSchema } from "../../configs/evals/types.js";
import {
  type AgentStatus,
  agentStatusSchema,
  applyStatusSchema as applyStatusValueSchema,
  EVAL_REQUIRED_AGENT_STATUSES,
  IN_PROGRESS_AGENT_STATUSES,
  runStatusSchema,
  TERMINAL_AGENT_STATUSES,
} from "../../status/index.js";
import { assertRepoRelativePath } from "../../utils/path.js";
import type { ChatArtifactFormat } from "../../workspace/chat/types.js";

export type { AgentStatus };
export {
  agentStatusSchema,
  EVAL_REQUIRED_AGENT_STATUSES,
  IN_PROGRESS_AGENT_STATUSES,
  TERMINAL_AGENT_STATUSES,
};

function validateRepoRelativePath(value: string, ctx: z.RefinementCtx): void {
  try {
    assertRepoRelativePath(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        error instanceof Error ? error.message : "invalid repo-relative path",
    });
  }
}

const repoRelativePathSchema = z
  .string()
  .superRefine((value, ctx) => validateRepoRelativePath(value, ctx));

export const runSpecDescriptorSchema = z.object({
  path: repoRelativePathSchema,
});

export type RunSpecDescriptor = z.infer<typeof runSpecDescriptorSchema>;

const CHAT_ARTIFACT_FORMATS = [
  "json",
  "jsonl",
] as const satisfies readonly ChatArtifactFormat[];

const WATCHDOG_TRIGGERS = [
  "silence",
  "wall-clock",
  "fatal-pattern",
  "sandbox-denial",
] as const;
const FAIL_FAST_OPERATIONS = [
  "network-connect",
  "file-read",
  "file-write",
] as const;

export const watchdogMetadataSchema = z.object({
  /** Silence timeout in milliseconds that was enforced. */
  silenceTimeoutMs: z.number(),
  /** Wall-clock cap in milliseconds that was enforced. */
  wallClockCapMs: z.number(),
  /** Which watchdog trigger caused termination, if any. */
  trigger: z.enum(WATCHDOG_TRIGGERS).optional(),
});

export type WatchdogMetadata = z.infer<typeof watchdogMetadataSchema>;

export const agentArtifactStateSchema = z.object({
  diffAttempted: z.boolean().optional(),
  diffCaptured: z.boolean().optional(),
  stdoutCaptured: z.boolean().optional(),
  stderrCaptured: z.boolean().optional(),
  summaryCaptured: z.boolean().optional(),
  chatCaptured: z.boolean().optional(),
  chatFormat: z.enum(CHAT_ARTIFACT_FORMATS).optional(),
});

export type AgentArtifactState = z.infer<typeof agentArtifactStateSchema>;

export const agentEvalSnapshotSchema = z.object({
  slug: evalSlugSchema,
  status: evalStatusSchema,
  exitCode: z.number().nullable().optional(),
  command: z.string().optional(),
  hasLog: z.boolean().optional(),
  error: z.string().optional(),
});

export type AgentEvalSnapshot = z.infer<typeof agentEvalSnapshotSchema>;

export type AgentEvalView = AgentEvalSnapshot & { logPath?: string };

export const agentInvocationRecordSchema = z
  .object({
    agentId: agentIdSchema,
    model: z.string(),
    status: agentStatusSchema,
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    commitSha: z.string().optional(),
    artifacts: agentArtifactStateSchema.optional(),
    evals: z.array(agentEvalSnapshotSchema).optional(),
    error: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    diffStatistics: z.string().optional(),
    watchdog: watchdogMetadataSchema.optional(),
    failFastTriggered: z.boolean().optional(),
    failFastTarget: z.string().optional(),
    failFastOperation: z.enum(FAIL_FAST_OPERATIONS).optional(),
  })
  .superRefine((data, ctx) => {
    if (IN_PROGRESS_AGENT_STATUSES.includes(data.status)) {
      return;
    }

    if (TERMINAL_AGENT_STATUSES.includes(data.status)) {
      if (!data.startedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startedAt"],
          message: "startedAt is required once the agent completes",
        });
      }

      if (!data.completedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["completedAt"],
          message: "completedAt is required once the agent completes",
        });
      }

      if (EVAL_REQUIRED_AGENT_STATUSES.includes(data.status) && !data.evals) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evals"],
          message: "eval results are required once the agent completes",
        });
      }
    }

    if (data.failFastTriggered) {
      if (!data.failFastTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failFastTarget"],
          message: "failFastTarget is required when failFastTriggered is true",
        });
      }
      if (!data.failFastOperation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failFastOperation"],
          message:
            "failFastOperation is required when failFastTriggered is true",
        });
      }
    }
  });

export type AgentInvocationRecord = z.infer<typeof agentInvocationRecordSchema>;

export const applyStatusSchema = z.object({
  agentId: agentIdSchema,
  status: applyStatusValueSchema,
  appliedAt: z.string(),
  ignoredBaseMismatch: z.boolean(),
  appliedCommitSha: z.string().min(1).optional(),
  detail: z.string().max(256).nullable().optional(),
});

export type RunApplyStatus = z.infer<typeof applyStatusSchema>;

export const runRecordSchema = z.object({
  runId: z.string(),
  baseRevisionSha: z.string(),
  rootPath: repoRelativePathSchema,
  spec: runSpecDescriptorSchema,
  status: runStatusSchema,
  createdAt: z.string(),
  agents: z.array(agentInvocationRecordSchema),
  applyStatus: applyStatusSchema.optional(),
  deletedAt: z.string().nullable().optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

export type AgentReport = {
  agentId: AgentInvocationRecord["agentId"];
  status: AgentInvocationRecord["status"];
  runtimeManifestPath: string;
  baseDirectory: string;
  assets: {
    stdoutPath?: string;
    stderrPath?: string;
    diffPath?: string;
    summaryPath?: string;
    chatPath?: string;
  };
  evals: AgentEvalView[];
  startedAt: string;
  completedAt: string;
  diffStatistics?: string;
  error?: string;
  warnings?: string[];
  diffAttempted: boolean;
  diffCaptured: boolean;
};

export type RunReport = {
  runId: RunRecord["runId"];
  spec: RunRecord["spec"];
  status: RunRecord["status"];
  createdAt: RunRecord["createdAt"];
  baseRevisionSha: RunRecord["baseRevisionSha"];
  agents: AgentReport[];
  hadAgentFailure: boolean;
  hadEvalFailure: boolean;
};
