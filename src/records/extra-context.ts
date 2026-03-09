import { z } from "zod";

import {
  assertExtraContextSourcePath,
  assertExtraContextStagedPath,
} from "../extra-context/contract.js";
import { assertRepoRelativePath } from "../utils/path.js";

function validateLegacyOrStagedExtraContextPath(
  value: string,
  ctx: z.RefinementCtx,
): void {
  try {
    assertExtraContextStagedPath(value);
    return;
  } catch {
    // Fall through to legacy repo-relative parsing for backwards compatibility.
  }

  try {
    assertRepoRelativePath(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Path must be a staged session-relative path under "../context/" or a legacy repo-relative path.',
    });
  }
}

function validateExtraContextStagedPath(
  value: string,
  ctx: z.RefinementCtx,
): void {
  try {
    assertExtraContextStagedPath(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        error instanceof Error
          ? error.message
          : 'Path must be staged under "../context/".',
    });
  }
}

function validateExtraContextSourcePath(
  value: string,
  ctx: z.RefinementCtx,
): void {
  try {
    assertExtraContextSourcePath(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        error instanceof Error
          ? error.message
          : "Path must be a non-empty normalized source path.",
    });
  }
}

export const persistedExtraContextPathSchema = z
  .string()
  .superRefine((value, ctx) =>
    validateLegacyOrStagedExtraContextPath(value, ctx),
  );

export const stagedExtraContextPathSchema = z
  .string()
  .superRefine((value, ctx) => validateExtraContextStagedPath(value, ctx));

export const extraContextSourcePathSchema = z
  .string()
  .superRefine((value, ctx) => validateExtraContextSourcePath(value, ctx));

export const extraContextMetadataEntrySchema = z.object({
  stagedPath: stagedExtraContextPathSchema,
  sourcePath: extraContextSourcePathSchema,
});

export type ExtraContextMetadataEntry = z.infer<
  typeof extraContextMetadataEntrySchema
>;
