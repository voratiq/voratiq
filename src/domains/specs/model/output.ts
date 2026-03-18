import { readFile } from "node:fs/promises";

import { z } from "zod";

export const specDataSchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  scope: z.array(z.string().trim().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).min(1),
  outOfScope: z.array(z.string().trim().min(1)).optional(),
  exitSignal: z.string().trim().min(1),
});

export type SpecData = z.infer<typeof specDataSchema>;

export function parseSpecData(rawSpecData: string): SpecData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSpecData) as unknown;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "invalid JSON syntax";
    throw new Error(`Invalid JSON: ${reason}`);
  }

  const validation = specDataSchema.safeParse(parsed);
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

export async function readSpecData(specDataPath: string): Promise<SpecData> {
  const rawSpecData = await readFile(specDataPath, "utf8");
  return parseSpecData(rawSpecData);
}
