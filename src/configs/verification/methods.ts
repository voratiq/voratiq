import { z } from "zod";

import {
  CHECK_STATUS_VALUES,
  type CheckStatus,
  checkStatusSchema,
} from "../../status/index.js";

const PROGRAMMATIC_SLUG_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const RUBRIC_TEMPLATE_PATTERN = /^[a-z0-9]+(?:[./-][a-z0-9]+)*$/u;

export const programmaticSlugSchema = z
  .string()
  .min(1, "programmatic slug is required")
  .regex(
    PROGRAMMATIC_SLUG_PATTERN,
    "programmatic slug must contain only lowercase letters, numbers, dots, or hyphens",
  );

export type ProgrammaticSlug = z.infer<typeof programmaticSlugSchema>;

export const programmaticStatusSchema = checkStatusSchema;

export type ProgrammaticStatus = (typeof CHECK_STATUS_VALUES)[number];

export const programmaticCommandSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

export interface ProgrammaticCommandEntry {
  slug: ProgrammaticSlug;
  command?: string;
}

export const rubricTemplateSchema = z
  .string()
  .trim()
  .min(1, "rubric template is required")
  .regex(
    RUBRIC_TEMPLATE_PATTERN,
    "rubric template must contain only lowercase letters, numbers, dots, slashes, or hyphens",
  );

export type RubricTemplate = z.infer<typeof rubricTemplateSchema>;

export const programmaticCheckResultSchema = z.object({
  slug: programmaticSlugSchema,
  status: programmaticStatusSchema,
  command: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  logPath: z.string().optional(),
  error: z.string().optional(),
});

export type ProgrammaticCheckResult = z.infer<
  typeof programmaticCheckResultSchema
>;

export function normalizeProgrammaticCommand(
  command: string | undefined,
): string | undefined {
  if (command === undefined) {
    return undefined;
  }
  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function sanitizeSlugForFilename(slug: string): string {
  return slug.replace(/[^a-z0-9.-]/gu, "-");
}

export type { CheckStatus };
