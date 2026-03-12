import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import { extractedTokenUsageSchema } from "../../../domains/runs/model/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  type ReviewStatus,
  reviewStatusSchema,
  TERMINAL_REVIEW_STATUSES,
} from "../../../status/index.js";
import {
  validateOperationLifecycleTimestamps,
  validateRecordLifecycleTimestamps,
} from "../../shared/lifecycle.js";
import { BLINDED_ALIAS_PATTERN } from "../candidates.js";

export type { ReviewStatus };
export { reviewStatusSchema, TERMINAL_REVIEW_STATUSES };

const blindedAliasSchema = z.string().regex(BLINDED_ALIAS_PATTERN, {
  message: "Blinded alias must match /^r_[a-z0-9]{10,16}$/",
});

const blindedAliasMapSchema = z.record(blindedAliasSchema, agentIdSchema);

export const reviewRecordReviewerSchema = z
  .object({
    agentId: agentIdSchema,
    status: reviewStatusSchema,
    outputPath: repoRelativeRecordPathSchema,
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    tokenUsage: extractedTokenUsageSchema.optional(),
    error: z.string().nullable().optional(),
  })
  .superRefine((reviewer, ctx) => {
    validateOperationLifecycleTimestamps(
      {
        status: reviewer.status,
        startedAt: reviewer.startedAt,
        completedAt: reviewer.completedAt,
      },
      ctx,
      {
        queued: ["queued"],
        running: ["running"],
        terminal: TERMINAL_REVIEW_STATUSES,
      },
    );
  });

export const reviewRecordSchema = z
  .object({
    sessionId: z.string(),
    runId: z.string(),
    createdAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    status: reviewStatusSchema,
    extraContext: z.array(persistedExtraContextPathSchema).optional(),
    extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
    reviewers: z
      .array(reviewRecordReviewerSchema)
      .min(1)
      .superRefine((reviewers, ctx) => {
        const seen = new Set<string>();
        for (const reviewer of reviewers) {
          if (seen.has(reviewer.agentId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate reviewer agent id: ${reviewer.agentId}`,
            });
            return;
          }
          seen.add(reviewer.agentId);
        }
      }),
    blinded: z
      .object({
        enabled: z.literal(true),
        aliasMap: blindedAliasMapSchema,
      })
      .optional(),
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
        terminal: TERMINAL_REVIEW_STATUSES,
      },
    );
  });

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export type ReviewIndexEntry = Pick<
  ReviewRecord,
  "sessionId" | "createdAt" | "status"
>;
