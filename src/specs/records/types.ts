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

export const specIterationRecordSchema = z.object({
  iteration: z.number().int().positive(),
  createdAt: z.string(),
  accepted: z.boolean(),
});

export type SpecIterationRecord = z.infer<typeof specIterationRecordSchema>;

export const specRecordStatusSchema = z.enum([
  "drafting",
  "awaiting-feedback",
  "refining",
  "saving",
  "saved",
  "aborted",
  "failed",
]);

export type SpecRecordStatus = z.infer<typeof specRecordStatusSchema>;

export const specRecordSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  status: specRecordStatusSchema,
  agentId: agentIdSchema,
  title: z.string(),
  slug: z.string(),
  outputPath: repoRelativePathSchema,
  iterations: z.array(specIterationRecordSchema),
  error: z.string().nullable().optional(),
});

export type SpecRecord = z.infer<typeof specRecordSchema>;

export type SpecIndexEntry = Pick<
  SpecRecord,
  "sessionId" | "createdAt" | "status"
>;

export const TERMINAL_SPEC_STATUSES: SpecRecordStatus[] = [
  "saved",
  "aborted",
  "failed",
];
