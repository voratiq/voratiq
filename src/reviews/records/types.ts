import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import {
  type ReviewStatus,
  reviewStatusSchema,
  TERMINAL_REVIEW_STATUSES,
} from "../../status/index.js";
import { assertRepoRelativePath } from "../../utils/path.js";

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

export const reviewRecordSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  status: reviewStatusSchema,
  agentId: agentIdSchema,
  outputPath: repoRelativePathSchema,
  error: z.string().nullable().optional(),
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export type ReviewIndexEntry = Pick<
  ReviewRecord,
  "sessionId" | "createdAt" | "status"
>;
