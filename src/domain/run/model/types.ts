import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  type AgentStatus,
  agentStatusSchema,
  applyStatusSchema as applyStatusValueSchema,
  IN_PROGRESS_AGENT_STATUSES,
  runStatusSchema,
  TERMINAL_AGENT_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "../../../status/index.js";
import type { TokenUsageResult } from "../../../workspace/chat/token-usage-result.js";
import type { ChatArtifactFormat } from "../../../workspace/chat/types.js";
import {
  validateOperationLifecycleTimestamps,
  validateRecordLifecycleTimestamps,
} from "../../shared/lifecycle.js";

export type { AgentStatus };
export {
  agentStatusSchema,
  IN_PROGRESS_AGENT_STATUSES,
  TERMINAL_AGENT_STATUSES,
};

const RUN_SPEC_TARGET_KIND_VALUES = ["file", "spec"] as const;
const RUN_SPEC_PROVENANCE_LINEAGE_VALUES = [
  "exact",
  "derived",
  "derived_modified",
  "invalid",
] as const;
const RUN_SPEC_PROVENANCE_ISSUE_VALUES = [
  "malformed_frontmatter",
  "stale_source",
] as const;

export const runSpecTargetKindSchema = z.enum(RUN_SPEC_TARGET_KIND_VALUES);
export const runSpecProvenanceLineageSchema = z.enum(
  RUN_SPEC_PROVENANCE_LINEAGE_VALUES,
);
export const runSpecProvenanceIssueSchema = z.enum(
  RUN_SPEC_PROVENANCE_ISSUE_VALUES,
);

export const runSpecContentHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u);

export const runSpecSourceDescriptorSchema = z
  .object({
    kind: z.literal("spec"),
    sessionId: z.string().min(1),
    agentId: agentIdSchema,
    outputPath: repoRelativeRecordPathSchema,
    contentHash: runSpecContentHashSchema,
  })
  .strict();

export type RunSpecSourceDescriptor = z.infer<
  typeof runSpecSourceDescriptorSchema
>;

export const runSpecSourceHintSchema = z
  .object({
    kind: z.literal("spec").optional(),
    sessionId: z.string().min(1).optional(),
    agentId: agentIdSchema.optional(),
    outputPath: repoRelativeRecordPathSchema.optional(),
    contentHash: runSpecContentHashSchema.optional(),
  })
  .strict();

export const exactRunSpecProvenanceSchema = z
  .object({
    lineage: z.literal("exact"),
    source: runSpecSourceDescriptorSchema.optional(),
  })
  .strict();

export const derivedRunSpecProvenanceSchema = z
  .object({
    lineage: z.literal("derived"),
    source: runSpecSourceDescriptorSchema,
    currentContentHash: runSpecContentHashSchema,
  })
  .strict();

export const derivedModifiedRunSpecProvenanceSchema = z
  .object({
    lineage: z.literal("derived_modified"),
    source: runSpecSourceDescriptorSchema,
    currentContentHash: runSpecContentHashSchema,
  })
  .strict();

export const invalidRunSpecProvenanceSchema = z
  .object({
    lineage: z.literal("invalid"),
    issueCode: runSpecProvenanceIssueSchema,
    source: runSpecSourceHintSchema.optional(),
    currentContentHash: runSpecContentHashSchema.optional(),
  })
  .strict();

export const runSpecProvenanceSchema = z.union([
  exactRunSpecProvenanceSchema,
  derivedRunSpecProvenanceSchema,
  derivedModifiedRunSpecProvenanceSchema,
  invalidRunSpecProvenanceSchema,
]);

export type RunSpecProvenance = z.infer<typeof runSpecProvenanceSchema>;

export const fileRunSpecTargetSchema = z
  .object({
    kind: z.literal("file"),
    provenance: invalidRunSpecProvenanceSchema.optional(),
  })
  .strict();

export const sessionRunSpecTargetSchema = z
  .object({
    kind: z.literal("spec"),
    sessionId: z.string().min(1),
    provenance: runSpecProvenanceSchema.optional(),
  })
  .strict();

export const runSpecTargetSchema = z.union([
  fileRunSpecTargetSchema,
  sessionRunSpecTargetSchema,
]);

export type RunSpecTarget = z.infer<typeof runSpecTargetSchema>;

export const runSpecDescriptorSchema = z.object({
  path: repoRelativeRecordPathSchema,
  target: runSpecTargetSchema.optional(),
});

export type RunSpecDescriptor = z.infer<typeof runSpecDescriptorSchema>;

const CHAT_ARTIFACT_FORMATS = [
  "json",
  "jsonl",
] as const satisfies readonly ChatArtifactFormat[];
export const CHAT_USAGE_PROVIDER_IDS = ["claude", "codex", "gemini"] as const;

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
const QUEUED_RUN_STATUSES = ["queued"] as const;
const RUNNING_RUN_STATUSES = ["running"] as const;

export const watchdogMetadataSchema = z.object({
  /** Silence timeout in milliseconds that was enforced. */
  silenceTimeoutMs: z.number(),
  /** Wall-clock cap in milliseconds that was enforced. */
  wallClockCapMs: z.number(),
  /** Which watchdog trigger caused termination, if any. */
  trigger: z.enum(WATCHDOG_TRIGGERS).optional(),
});

export type WatchdogMetadata = z.infer<typeof watchdogMetadataSchema>;

export type ChatUsageProviderId = (typeof CHAT_USAGE_PROVIDER_IDS)[number];

export const chatUsageProviderIdSchema = z.enum(CHAT_USAGE_PROVIDER_IDS);

const billingTokenCountSchema = z.number().int().nonnegative();
const AT_LEAST_ONE_USAGE_FIELD_MESSAGE =
  "At least one billing-relevant usage field is required.";

function withAtLeastOneUsageField<TShape extends z.ZodRawShape>(shape: TShape) {
  return z
    .object(shape)
    .strict()
    .refine(
      (value) => Object.values(value).some((field) => field !== undefined),
      {
        message: AT_LEAST_ONE_USAGE_FIELD_MESSAGE,
      },
    );
}

export const claudeExtractedTokenUsageSchema = withAtLeastOneUsageField({
  input_tokens: billingTokenCountSchema.optional(),
  output_tokens: billingTokenCountSchema.optional(),
  cache_read_input_tokens: billingTokenCountSchema.optional(),
  cache_creation_input_tokens: billingTokenCountSchema.optional(),
  cache_creation_ephemeral_5m_input_tokens: billingTokenCountSchema.optional(),
  cache_creation_ephemeral_1h_input_tokens: billingTokenCountSchema.optional(),
});

export type ClaudeExtractedTokenUsage = z.infer<
  typeof claudeExtractedTokenUsageSchema
>;

export const codexExtractedTokenUsageSchema = withAtLeastOneUsageField({
  input_tokens: billingTokenCountSchema.optional(),
  cached_input_tokens: billingTokenCountSchema.optional(),
  output_tokens: billingTokenCountSchema.optional(),
  reasoning_output_tokens: billingTokenCountSchema.optional(),
  total_tokens: billingTokenCountSchema.optional(),
});

export type CodexExtractedTokenUsage = z.infer<
  typeof codexExtractedTokenUsageSchema
>;

export const geminiExtractedTokenUsageSchema = withAtLeastOneUsageField({
  input: billingTokenCountSchema.optional(),
  output: billingTokenCountSchema.optional(),
  cached: billingTokenCountSchema.optional(),
  thoughts: billingTokenCountSchema.optional(),
  tool: billingTokenCountSchema.optional(),
  total: billingTokenCountSchema.optional(),
});

export type GeminiExtractedTokenUsage = z.infer<
  typeof geminiExtractedTokenUsageSchema
>;

export const extractedTokenUsageSchemaByProvider = {
  claude: claudeExtractedTokenUsageSchema,
  codex: codexExtractedTokenUsageSchema,
  gemini: geminiExtractedTokenUsageSchema,
} as const satisfies Record<ChatUsageProviderId, z.ZodTypeAny>;

export const extractedTokenUsageSchema = z.union([
  claudeExtractedTokenUsageSchema,
  codexExtractedTokenUsageSchema,
  geminiExtractedTokenUsageSchema,
]);

export type ExtractedTokenUsage = z.infer<typeof extractedTokenUsageSchema>;

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

export const agentInvocationRecordSchema = z
  .object({
    agentId: agentIdSchema,
    model: z.string(),
    status: agentStatusSchema,
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    commitSha: z.string().optional(),
    artifacts: agentArtifactStateSchema.optional(),
    error: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    diffStatistics: z.string().optional(),
    tokenUsage: extractedTokenUsageSchema.optional(),
    watchdog: watchdogMetadataSchema.optional(),
    failFastTriggered: z.boolean().optional(),
    failFastTarget: z.string().optional(),
    failFastOperation: z.enum(FAIL_FAST_OPERATIONS).optional(),
  })
  .superRefine((data, ctx) => {
    validateOperationLifecycleTimestamps(
      {
        status: data.status,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
      },
      ctx,
      {
        queued: ["queued"],
        running: ["running"],
        terminal: TERMINAL_AGENT_STATUSES,
      },
    );

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

export const AUTO_TERMINAL_STATUS_VALUES = [
  "succeeded",
  "failed",
  "aborted",
  "action_required",
] as const;

export type AutoTerminalStatus = (typeof AUTO_TERMINAL_STATUS_VALUES)[number];

export const autoTerminalStatusSchema = z.enum(AUTO_TERMINAL_STATUS_VALUES);

export const AUTO_APPLY_STATUS_VALUES = [
  "succeeded",
  "failed",
  "skipped",
] as const;

export type AutoApplyStatus = (typeof AUTO_APPLY_STATUS_VALUES)[number];

export const autoApplyStatusSchema = z.enum(AUTO_APPLY_STATUS_VALUES);

export const autoOutcomeSchema = z.object({
  status: autoTerminalStatusSchema,
  completedAt: z.string(),
  detail: z.string().max(256).nullable().optional(),
  apply: z.object({
    status: autoApplyStatusSchema,
    agentId: agentIdSchema.optional(),
    detail: z.string().max(256).nullable().optional(),
  }),
});

export type RunAutoOutcome = z.infer<typeof autoOutcomeSchema>;

const runRecordBaseSchema = z.object({
  runId: z.string(),
  baseRevisionSha: z.string(),
  rootPath: repoRelativeRecordPathSchema,
  spec: runSpecDescriptorSchema,
  extraContext: z.array(persistedExtraContextPathSchema).optional(),
  extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  agents: z.array(agentInvocationRecordSchema),
  applyStatus: applyStatusSchema.optional(),
  auto: autoOutcomeSchema.optional(),
});

export const runRecordSchema = runRecordBaseSchema
  .extend({
    status: runStatusSchema,
  })
  .superRefine((record, ctx) => {
    // Enforce the canonical queued/running/terminal timestamp contract.
    validateRecordLifecycleTimestamps(
      {
        status: record.status,
        createdAt: record.createdAt,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
      ctx,
      {
        queued: QUEUED_RUN_STATUSES,
        running: RUNNING_RUN_STATUSES,
        terminal: TERMINAL_RUN_STATUSES,
      },
    );
  });

export type RunRecord = z.infer<typeof runRecordSchema>;

export type AgentReport = {
  agentId: AgentInvocationRecord["agentId"];
  status: AgentInvocationRecord["status"];
  tokenUsage?: ExtractedTokenUsage;
  tokenUsageResult: TokenUsageResult;
  runtimeManifestPath: string;
  baseDirectory: string;
  assets: {
    stdoutPath?: string;
    stderrPath?: string;
    diffPath?: string;
    summaryPath?: string;
    chatPath?: string;
  };
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
  startedAt?: RunRecord["startedAt"];
  completedAt?: RunRecord["completedAt"];
  baseRevisionSha: RunRecord["baseRevisionSha"];
  agents: AgentReport[];
  hadAgentFailure: boolean;
};
