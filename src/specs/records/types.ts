import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import {
  type SpecRecordStatus,
  specRecordStatusSchema,
  TERMINAL_SPEC_STATUSES,
} from "../../status/index.js";
import { assertRepoRelativePath } from "../../utils/path.js";

export type { SpecRecordStatus };
export { specRecordStatusSchema, TERMINAL_SPEC_STATUSES };

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

export const specRecordSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  status: specRecordStatusSchema,
  agentId: agentIdSchema,
  title: z.string(),
  slug: z.string(),
  outputPath: repoRelativePathSchema,
  error: z.string().nullable().optional(),
});

export type SpecRecord = z.infer<typeof specRecordSchema>;

export type SpecIndexEntry = Pick<
  SpecRecord,
  "sessionId" | "createdAt" | "status"
>;
