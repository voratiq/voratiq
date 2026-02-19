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
  const resolved = resolvePreferredAgents({
    preferredAgents: recommendation.preferred_agents,
    aliasMap,
  });

  return {
    recommendation: {
      ...recommendation,
      resolved_preferred_agents: resolved.preferredAgents,
    },
    ...(resolved.warnings.length > 0 ? { warnings: resolved.warnings } : {}),
  };
}

function resolvePreferredAgents(options: {
  preferredAgents: readonly string[];
  aliasMap: Record<string, string>;
}): { preferredAgents: string[]; warnings: string[] } {
  const { preferredAgents, aliasMap } = options;
  const warnings: string[] = [];
  const resolved: string[] = [];
  const canonicalAgents = new Set(Object.values(aliasMap));

  for (const selector of preferredAgents) {
    if (isBlindedCandidateAlias(selector)) {
      const canonical = aliasMap[selector];
      if (!canonical) {
        throw new ReviewGenerationFailedError([
          `Unknown blinded candidate id: ${selector}`,
          "Ensure the recommendation uses the candidate ids listed in the prompt.",
        ]);
      }
      resolved.push(canonical);
      continue;
    }

    if (canonicalAgents.has(selector)) {
      warnings.push(`Canonical agent id used in recommendation: ${selector}`);
      resolved.push(selector);
      continue;
    }

    throw new ReviewGenerationFailedError([
      `Unknown candidate selector: ${selector}`,
      "Use a blinded candidate id (r_...) or a known canonical agent id.",
    ]);
  }

  return {
    preferredAgents: Array.from(new Set(resolved)),
    warnings,
  };
}
