import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import { extractedTokenUsageSchema } from "../../../domains/runs/model/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  type SpecAgentStatus,
  specAgentStatusSchema,
  type SpecRecordStatus,
  specRecordStatusSchema,
  TERMINAL_SPEC_AGENT_STATUSES,
  TERMINAL_SPEC_STATUSES,
} from "../../../status/index.js";
import {
  validateOperationLifecycleTimestamps,
  validateRecordLifecycleTimestamps,
} from "../../shared/lifecycle.js";

export type { SpecAgentStatus, SpecRecordStatus };
export {
  specAgentStatusSchema,
  specRecordStatusSchema,
  TERMINAL_SPEC_AGENT_STATUSES,
  TERMINAL_SPEC_STATUSES,
};

const IN_PROGRESS_SPEC_STATUSES = [
  "running",
] as const satisfies readonly SpecRecordStatus[];

export const specAgentEntrySchema = z
  .object({
    agentId: agentIdSchema,
    status: specAgentStatusSchema,
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    outputPath: repoRelativeRecordPathSchema.optional(),
    dataPath: repoRelativeRecordPathSchema.optional(),
    tokenUsage: extractedTokenUsageSchema.optional(),
    error: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "succeeded") {
      if (!data.outputPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outputPath"],
          message: "succeeded spec agents must persist `outputPath`",
        });
      }
      if (!data.dataPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dataPath"],
          message: "succeeded spec agents must persist `dataPath`",
        });
      }
    }
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
        terminal: TERMINAL_SPEC_AGENT_STATUSES,
      },
    );
  });

export type SpecAgentEntry = z.infer<typeof specAgentEntrySchema>;

export const specRecordSchema = z
  .object({
    sessionId: z.string(),
    createdAt: z.string(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    status: specRecordStatusSchema,
    description: z.string(),
    extraContext: z.array(persistedExtraContextPathSchema).optional(),
    extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
    agents: z.array(specAgentEntrySchema),
    error: z.string().nullable().optional(),
  })
  .superRefine((record, ctx) => {
    // Enforce the canonical running/terminal timestamp contract.
    validateRecordLifecycleTimestamps(
      {
        status: record.status,
        createdAt: record.createdAt,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
      ctx,
      {
        queued: [],
        running: IN_PROGRESS_SPEC_STATUSES,
        terminal: TERMINAL_SPEC_STATUSES,
      },
    );
  });

export type SpecRecord = z.infer<typeof specRecordSchema>;

export type SpecIndexEntry = Pick<
  SpecRecord,
  "sessionId" | "createdAt" | "status"
>;

/**
 * Derive the session-level spec status from per-agent outcomes.
 * Returns "succeeded" when at least one agent succeeds; otherwise "failed".
 */
export function deriveSpecStatusFromAgents(
  agentStatuses: readonly SpecAgentStatus[],
): SpecRecordStatus {
  const hasSuccess = agentStatuses.some((status) => status === "succeeded");
  return hasSuccess ? "succeeded" : "failed";
}
