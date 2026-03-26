import { z } from "zod";

export const rubricResultPayloadSchema = z.object({}).catchall(z.unknown());

export type RubricResultPayload = z.infer<typeof rubricResultPayloadSchema>;

const verificationSelectorSchema = z.string().trim().min(1);

export const rubricRecommendationSchema = z
  .object({
    preferred: verificationSelectorSchema.optional(),
    ranking: z.array(verificationSelectorSchema).min(1).optional(),
    rationale: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.preferred !== undefined &&
      value.ranking !== undefined &&
      value.ranking[0] !== value.preferred
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferred"],
        message: "`preferred` must match `ranking[0]` when both are present",
      });
    }
  });

export type RubricRecommendation = z.infer<typeof rubricRecommendationSchema>;

export function parseRubricResultPayload(raw: string): RubricResultPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Invalid verifier result.json: ${reason}`);
  }

  const validation = rubricResultPayloadSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      "Invalid verifier result.json: expected a top-level JSON object",
    );
  }

  return validation.data;
}

export function safeParseRubricRecommendationFromResult(
  result: RubricResultPayload,
):
  | { success: true; data: RubricRecommendation | undefined }
  | {
      success: false;
      error: z.ZodError<RubricRecommendation>;
    } {
  const candidate = extractRubricRecommendationCandidate(result);
  if (!candidate) {
    return {
      success: true,
      data: undefined,
    };
  }

  const validation = rubricRecommendationSchema.safeParse(candidate);
  if (!validation.success) {
    return validation;
  }

  return {
    success: true,
    data: validation.data,
  };
}

export function parseRubricRecommendationFromResult(
  result: RubricResultPayload,
): RubricRecommendation | undefined {
  const validation = safeParseRubricRecommendationFromResult(result);
  if (!validation.success) {
    throw new Error(formatRubricResultIssues(validation.error.issues));
  }
  return validation.data;
}

export function readRubricResultPreferred(
  result: RubricResultPayload,
): string | undefined {
  return normalizeNonEmptyString(result["preferred"]);
}

export function readRubricResultRanking(
  result: RubricResultPayload,
): string[] | undefined {
  const value = result["ranking"];
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    return undefined;
  }

  const ranking = value.map((entry) => entry.trim());
  return ranking.every((entry) => entry.length > 0) ? ranking : undefined;
}

export function readRubricResultComparison(
  result: RubricResultPayload,
): string | undefined {
  return normalizeNonEmptyString(result["comparison"]);
}

export function readRubricResultRationale(
  result: RubricResultPayload,
): string | undefined {
  return normalizeNonEmptyString(result["rationale"]);
}

export function readRubricResultNextActions(
  result: RubricResultPayload,
): string[] | undefined {
  const value = result["next_actions"];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const actions = value
    .map((entry) => normalizeNonEmptyString(entry))
    .filter((entry): entry is string => entry !== undefined);

  return actions.length > 0 ? actions : undefined;
}

export function readRubricResultNarrative(
  result: RubricResultPayload,
): string | undefined {
  return (
    readRubricResultRationale(result) ?? readRubricResultComparison(result)
  );
}

export function formatRubricResultIssues(
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>,
): string {
  return issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function extractRubricRecommendationCandidate(
  result: RubricResultPayload,
): RubricRecommendation | undefined {
  const preferred = readRubricResultPreferred(result);
  const ranking = readRubricResultRanking(result);
  const rationale = readRubricResultNarrative(result);

  if (
    preferred === undefined &&
    ranking === undefined &&
    rationale === undefined
  ) {
    return undefined;
  }

  return {
    ...(preferred !== undefined ? { preferred } : {}),
    ...(ranking !== undefined ? { ranking } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
  };
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
