import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import {
  type ReviewStatus,
  reviewStatusSchema,
  TERMINAL_REVIEW_STATUSES,
} from "../../status/index.js";
import { assertRepoRelativePath } from "../../utils/path.js";
import { BLINDED_ALIAS_PATTERN } from "../candidates.js";

export type { ReviewStatus };
export { reviewStatusSchema, TERMINAL_REVIEW_STATUSES };

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

const blindedAliasSchema = z.string().regex(BLINDED_ALIAS_PATTERN, {
  message: "Blinded alias must match /^r_[a-z0-9]{10,16}$/",
});

const blindedAliasMapSchema = z.record(blindedAliasSchema, agentIdSchema);

export const reviewRecordSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  status: reviewStatusSchema,
  agentId: agentIdSchema,
  outputPath: repoRelativePathSchema,
  blinded: z
    .object({
      enabled: z.literal(true),
      aliasMap: blindedAliasMapSchema,
    })
    .optional(),
  error: z.string().nullable().optional(),
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export type ReviewIndexEntry = Pick<
  ReviewRecord,
  "sessionId" | "createdAt" | "status"
>;
