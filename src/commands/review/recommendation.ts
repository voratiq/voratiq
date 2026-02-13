import { readFile } from "node:fs/promises";

import { z } from "zod";

export const reviewRecommendationSchema = z
  .object({
    version: z.literal(1),
    preferred_agents: z.array(z.string().min(1)),
    rationale: z.string(),
    next_actions: z.array(z.string()),
  })
  .strict();

export type ReviewRecommendation = z.infer<typeof reviewRecommendationSchema>;

export function parseReviewRecommendation(
  rawRecommendation: string,
): ReviewRecommendation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawRecommendation) as unknown;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "invalid JSON syntax";
    throw new Error(`Invalid JSON: ${reason}`);
  }

  const validation = reviewRecommendationSchema.safeParse(parsed);
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

export async function readReviewRecommendation(
  recommendationPath: string,
): Promise<ReviewRecommendation> {
  const rawRecommendation = await readFile(recommendationPath, "utf8");
  return parseReviewRecommendation(rawRecommendation);
}
