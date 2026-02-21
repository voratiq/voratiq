import { readFile } from "node:fs/promises";

import { z } from "zod";

export const reviewRecommendationSchema = z
  .object({
    preferred_agent: z
      .string()
      .trim()
      .min(1)
      .refine((value) => value.toLowerCase() !== "none", {
        message: "must not be 'none'",
      }),
    resolved_preferred_agent: z.string().trim().min(1).optional(),
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

export function assertRecommendationMatchesRanking(options: {
  recommendation: ReviewRecommendation;
  ranking: readonly string[];
}): void {
  const { recommendation, ranking } = options;
  if (ranking.length === 0) {
    throw new Error("Ranking must include at least one candidate.");
  }

  const topRanked = ranking[0];
  if (!topRanked) {
    throw new Error("Ranking is missing the #1 candidate.");
  }

  if (recommendation.preferred_agent !== topRanked) {
    throw new Error(
      `Recommendation preferred_agent (${recommendation.preferred_agent}) must match ranking #1 (${topRanked}).`,
    );
  }
}

export async function readReviewRecommendation(
  recommendationPath: string,
): Promise<ReviewRecommendation> {
  const rawRecommendation = await readFile(recommendationPath, "utf8");
  return parseReviewRecommendation(rawRecommendation);
}
