import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import { extractedTokenUsageSchema } from "../../../domains/runs/model/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  type ReductionStatus,
  reductionStatusSchema,
  TERMINAL_REDUCTION_STATUSES,
} from "../../../status/index.js";
import {
  validateOperationLifecycleTimestamps,
  validateRecordLifecycleTimestamps,
} from "../../shared/lifecycle.js";

export type { ReductionStatus };
export { reductionStatusSchema, TERMINAL_REDUCTION_STATUSES };

export const reductionTargetTypeSchema = z.enum([
  "spec",
  "run",
  "verification",
  "reduction",
]);

export type ReductionTargetType = z.infer<typeof reductionTargetTypeSchema>;

export const reductionTargetSchema = z
  .object({
    type: reductionTargetTypeSchema,
    id: z.string(),
  })
  .strict();

export type ReductionTarget = z.infer<typeof reductionTargetSchema>;

export const reductionRecordReducerSchema = z
  .object({
    agentId: agentIdSchema,
    status: reductionStatusSchema,
    outputPath: repoRelativeRecordPathSchema,
    dataPath: repoRelativeRecordPathSchema.optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    tokenUsage: extractedTokenUsageSchema.optional(),
    error: z.string().nullable().optional(),
  })
  .superRefine((reducer, ctx) => {
    validateOperationLifecycleTimestamps(
      {
        status: reducer.status,
        startedAt: reducer.startedAt,
        completedAt: reducer.completedAt,
      },
      ctx,
      {
        queued: ["queued"],
        running: ["running"],
        terminal: TERMINAL_REDUCTION_STATUSES,
      },
    );
  });

export const reductionRecordSchema = z
  .object({
    sessionId: z.string(),
    target: reductionTargetSchema,
    createdAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    status: reductionStatusSchema,
    extraContext: z.array(persistedExtraContextPathSchema).optional(),
    extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
    reducers: z
      .array(reductionRecordReducerSchema)
      .min(1)
      .superRefine((reducers, ctx) => {
        const seen = new Set<string>();
        for (const reducer of reducers) {
          if (seen.has(reducer.agentId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate reducer agent id: ${reducer.agentId}`,
            });
            return;
          }
          seen.add(reducer.agentId);
        }
      }),
    error: z.string().nullable().optional(),
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
        queued: ["queued"],
        running: ["running"],
        terminal: TERMINAL_REDUCTION_STATUSES,
      },
    );
  });

export type ReductionRecord = z.infer<typeof reductionRecordSchema>;

export type ReductionIndexEntry = Pick<
  ReductionRecord,
  "sessionId" | "createdAt" | "status"
>;
