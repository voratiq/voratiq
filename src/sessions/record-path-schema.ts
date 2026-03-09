import { z } from "zod";

import { assertRepoRelativePath } from "../utils/path.js";

export function validateRepoRelativeRecordPath(
  value: string,
  ctx: z.RefinementCtx,
): void {
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

export const repoRelativeRecordPathSchema = z
  .string()
  .superRefine((value, ctx) => validateRepoRelativeRecordPath(value, ctx));
