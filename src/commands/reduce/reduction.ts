import { readFile } from "node:fs/promises";

import { z } from "zod";

export const reductionArtifactSchema = z.object({
  summary: z.string().trim().min(1),
  directives: z.array(z.string().trim().min(1)).min(1),
  risks: z.array(z.string().trim().min(1)),
});

export type ReductionArtifact = z.infer<typeof reductionArtifactSchema>;

export function parseReductionArtifact(
  rawReduction: string,
): ReductionArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawReduction) as unknown;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "invalid JSON syntax";
    throw new Error(`Invalid JSON: ${reason}`);
  }

  const validation = reductionArtifactSchema.safeParse(parsed);
  if (!validation.success) {
    const detail = validation.error.issues
      .map((issue) => {
        const path =
          issue.path.length > 0 ? issue.path.map(String).join(".") : "root";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Schema validation failed: ${detail}`);
  }

  return validation.data;
}

export async function readReductionArtifact(
  reductionPath: string,
): Promise<ReductionArtifact> {
  const rawReduction = await readFile(reductionPath, "utf8");
  return parseReductionArtifact(rawReduction);
}
