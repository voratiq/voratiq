import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import { assertRepoRelativePath } from "../../utils/path.js";

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

export const reviewStatusSchema = z.enum(["running", "succeeded", "failed"]);

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

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

export const TERMINAL_REVIEW_STATUSES: readonly ReviewStatus[] = [
  "succeeded",
  "failed",
] as const;
