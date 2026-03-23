import { z } from "zod";

import {
  programmaticCommandSchema,
  programmaticSlugSchema,
} from "./methods.js";

export const verificationRubricEntrySchema = z
  .object({
    template: z.string().trim().min(1),
  })
  .strict();

export type VerificationRubricEntry = z.infer<
  typeof verificationRubricEntrySchema
>;

const verificationProgrammaticMapSchema = z
  .record(z.string(), programmaticCommandSchema)
  .transform((value) => {
    const entries: Array<{ slug: string; command?: string }> = [];
    for (const [rawSlug, rawCommand] of Object.entries(value)) {
      const slug = programmaticSlugSchema.parse(rawSlug.trim());
      const command = rawCommand ?? undefined;
      entries.push({ slug, ...(command ? { command } : {}) });
    }
    return entries;
  });

const verificationRubricOnlyStageConfigSchema = z
  .object({
    rubric: z.array(verificationRubricEntrySchema).optional().default([]),
  })
  .strict();

const verificationRunStageConfigSchema = z
  .object({
    programmatic: verificationProgrammaticMapSchema.optional().default([]),
    rubric: z.array(verificationRubricEntrySchema).optional().default([]),
  })
  .strict();

export type VerificationRubricOnlyStageConfig = z.infer<
  typeof verificationRubricOnlyStageConfigSchema
>;

export type VerificationRunStageConfig = z.infer<
  typeof verificationRunStageConfigSchema
>;

export const verificationConfigSchema = z
  .object({
    spec: verificationRubricOnlyStageConfigSchema
      .optional()
      .default({ rubric: [] }),
    run: verificationRunStageConfigSchema
      .optional()
      .default({ programmatic: [], rubric: [] }),
    reduce: verificationRubricOnlyStageConfigSchema
      .optional()
      .default({ rubric: [] }),
  })
  .strict();

export type VerificationConfig = z.infer<typeof verificationConfigSchema>;
