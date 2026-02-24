import { isBlindedCandidateAlias } from "../../reviews/candidates.js";
import { ReviewGenerationFailedError } from "./errors.js";
import type { ReviewRecommendation } from "./recommendation.js";

export interface ResolvedBlindedRecommendation {
  recommendation: ReviewRecommendation;
  warnings?: string[];
}

export function resolveBlindedRecommendation(options: {
  recommendation: ReviewRecommendation;
  aliasMap: Record<string, string>;
}): ResolvedBlindedRecommendation {
  const { recommendation, aliasMap } = options;
  const resolved = resolvePreferredAgent({
    preferredAgent: recommendation.preferred_agent,
    aliasMap,
  });

  // Validate ranking selectors against the alias map/canonical ids, but keep
  // reviewer-authored values unchanged in stored recommendation artifacts.
  recommendation.ranking.forEach((candidateId) =>
    resolveCandidateId({ candidateId, aliasMap }),
  );

  return {
    recommendation: {
      ...recommendation,
      resolved_preferred_agent: resolved.preferredAgent,
    },
    ...(resolved.warnings.length > 0 ? { warnings: resolved.warnings } : {}),
  };
}

function resolvePreferredAgent(options: {
  preferredAgent: string;
  aliasMap: Record<string, string>;
}): { preferredAgent: string; warnings: string[] } {
  const { preferredAgent, aliasMap } = options;
  const warnings: string[] = [];
  const canonicalAgents = new Set(Object.values(aliasMap));

  if (isBlindedCandidateAlias(preferredAgent)) {
    const canonical = aliasMap[preferredAgent];
    if (!canonical) {
      throw new ReviewGenerationFailedError(
        [`Unknown blinded candidate id: \`${preferredAgent}\`.`],
        ["Use candidate ids listed in the review prompt."],
      );
    }
    return {
      preferredAgent: canonical,
      warnings,
    };
  }

  if (canonicalAgents.has(preferredAgent)) {
    warnings.push(
      `Canonical agent id used in recommendation: ${preferredAgent}`,
    );
    return {
      preferredAgent,
      warnings,
    };
  }

  throw new ReviewGenerationFailedError(
    [`Unknown candidate selector: \`${preferredAgent}\`.`],
    ["Use a blinded candidate id or a known canonical agent id."],
  );
}

function resolveCandidateId(options: {
  candidateId: string;
  aliasMap: Record<string, string>;
}): string {
  const { candidateId, aliasMap } = options;
  if (isBlindedCandidateAlias(candidateId)) {
    const canonical = aliasMap[candidateId];
    if (!canonical) {
      throw new ReviewGenerationFailedError(
        [`Unknown blinded candidate id in ranking: \`${candidateId}\`.`],
        ["Ensure ranking includes only candidate ids listed in the prompt."],
      );
    }
    return canonical;
  }
  return candidateId;
}
