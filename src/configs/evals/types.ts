import { z } from "zod";

import {
  EVAL_STATUS_VALUES,
  evalStatusSchema as sharedEvalStatusSchema,
} from "../../status/index.js";

const EVAL_SLUG_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

export const evalSlugSchema = z
  .string()
  .min(1, "eval slug is required")
  .regex(
    EVAL_SLUG_PATTERN,
    "eval slug must contain only lowercase letters, numbers, dots, or hyphens",
  );

export type EvalSlug = z.infer<typeof evalSlugSchema>;

export const evalStatusSchema = sharedEvalStatusSchema;

export type EvalStatus = (typeof EVAL_STATUS_VALUES)[number];

export const evalCommandSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

export interface EvalCommandEntry {
  slug: EvalSlug;
  command?: string;
}

export type EvalsConfig = ReadonlyArray<EvalCommandEntry>;

export const evalsConfigSchema = z
  .record(z.string(), evalCommandSchema)
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const rawSlug of Object.keys(value)) {
      const trimmedSlug = rawSlug.trim();
      const parsed = evalSlugSchema.safeParse(trimmedSlug);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "invalid eval slug";
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [rawSlug],
          message,
        });
        continue;
      }
      if (seen.has(parsed.data)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [rawSlug],
          message: `Duplicate eval slug "${parsed.data}"`,
        });
      }
      seen.add(parsed.data);
    }
  })
  .transform((value) => {
    const entries: EvalCommandEntry[] = [];
    for (const [rawSlug, rawCommand] of Object.entries(value)) {
      const slug = evalSlugSchema.parse(rawSlug.trim());
      const normalizedCommand = normalizeEvalCommand(rawCommand);
      entries.push({ slug, command: normalizedCommand });
    }
    return entries;
  });

export const agentEvalResultSchema = z.object({
  slug: evalSlugSchema,
  status: evalStatusSchema,
  command: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  logPath: z.string().optional(),
  error: z.string().optional(),
});

export type AgentEvalResult = z.infer<typeof agentEvalResultSchema>;

export interface EvalDefinition {
  slug: EvalSlug;
  command?: string;
}

/**
 * Normalizes an eval command by trimming whitespace and converting empty strings to undefined.
 * Exported for reuse in init scaffolding and other contexts.
 */
export function normalizeEvalCommand(
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
