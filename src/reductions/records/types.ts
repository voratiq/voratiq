import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import {
  type ReductionStatus,
  reductionStatusSchema,
  TERMINAL_REDUCTION_STATUSES,
} from "../../status/index.js";
import { assertRepoRelativePath } from "../../utils/path.js";

export type { ReductionStatus };
export { reductionStatusSchema, TERMINAL_REDUCTION_STATUSES };

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

export const reductionTargetTypeSchema = z.enum([
  "spec",
  "run",
  "review",
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

export const reductionRecordReducerSchema = z.object({
  agentId: agentIdSchema,
  status: reductionStatusSchema,
  outputPath: repoRelativePathSchema,
  dataPath: repoRelativePathSchema.optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().nullable().optional(),
});

export const reductionRecordSchema = z.object({
  sessionId: z.string(),
  target: reductionTargetSchema,
  createdAt: z.string(),
  completedAt: z.string().optional(),
  status: reductionStatusSchema,
  extraContext: z.array(repoRelativePathSchema).optional(),
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
});

export type ReductionRecord = z.infer<typeof reductionRecordSchema>;

export type ReductionIndexEntry = Pick<
  ReductionRecord,
  "sessionId" | "createdAt" | "status"
>;
