import { generateBlindedCandidateAlias } from "../blinding/aliases.js";
import {
  parseRubricResultPayload,
  readRubricResultPreferred,
  readRubricResultRanking,
  type RubricResultPayload,
} from "../rubric-result.js";
import type { ResolvedVerificationTarget } from "./target.js";

export function buildBlindedAliasMap(
  resolvedTarget: ResolvedVerificationTarget,
): Record<string, string> | undefined {
  const candidateIds = resolvedTarget.competitiveCandidates.map(
    (candidate) => candidate.canonicalId,
  );

  if (candidateIds.length === 0) {
    return undefined;
  }

  const aliasMap: Record<string, string> = {};
  const seen = new Set<string>();
  for (const candidateId of [...new Set(candidateIds)].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const alias = generateBlindedCandidateAlias({ seen });
    seen.add(alias);
    aliasMap[alias] = candidateId;
  }
  return aliasMap;
}

export function aliasForCandidate(
  canonicalId: string,
  aliasMap?: Record<string, string>,
): string {
  if (!aliasMap) {
    return canonicalId;
  }
  const match = Object.entries(aliasMap).find(
    ([, value]) => value === canonicalId,
  );
  return match?.[0] ?? canonicalId;
}

export function assertRubricResultSelectorsMatchAliasMap(options: {
  artifactPath: string;
  result?: RubricResultPayload;
  aliasMap?: Record<string, string>;
}): void {
  const { artifactPath, result, aliasMap } = options;
  if (!aliasMap || !result) {
    return;
  }

  const unknownSelectors = new Set<string>();
  const preferred = readRubricResultPreferred(result);
  if (preferred && !aliasMap[preferred]) {
    unknownSelectors.add(preferred);
  }

  for (const selector of readRubricResultRanking(result) ?? []) {
    if (!aliasMap[selector]) {
      unknownSelectors.add(selector);
    }
  }

  if (unknownSelectors.size === 0) {
    return;
  }

  const selectors = Array.from(unknownSelectors)
    .sort((left, right) => left.localeCompare(right))
    .map((selector) => `\`${selector}\``)
    .join(", ");
  throw new Error(
    `Invalid verifier result.json for \`${artifactPath}\`: unknown blinded selector(s) ${selectors}.`,
  );
}

export function buildForbiddenVerificationIdentityTokens(options: {
  resolvedTarget: ResolvedVerificationTarget;
  allowed?: readonly string[];
}): string[] {
  const { resolvedTarget, allowed = [] } = options;
  const allowedTokens = new Set(
    allowed.map((token) => token.toLowerCase().trim()).filter(Boolean),
  );
  const tokens = new Set<string>();

  for (const candidate of resolvedTarget.competitiveCandidates) {
    for (const token of candidate.forbiddenIdentityTokens) {
      const normalized = token.toLowerCase().trim();
      if (!normalized || allowedTokens.has(normalized)) {
        continue;
      }
      tokens.add(normalized);
    }
  }

  return Array.from(tokens);
}

export function assertNoVerificationIdentityLeak(options: {
  text: string;
  forbidden: readonly string[];
}): void {
  const { text, forbidden } = options;
  const haystack = text.toLowerCase();
  const leaks = forbidden.filter((token) =>
    containsBoundedToken(haystack, token),
  );
  if (leaks.length === 0) {
    return;
  }

  const preview = leaks
    .slice(0, 5)
    .map((token) => `\`${token}\``)
    .join(", ");
  throw new Error(
    `Blinded verification leakage validation failed: forbidden candidate identity token(s) detected: ${preview}${leaks.length > 5 ? ", ..." : ""}.`,
  );
}

function containsBoundedToken(text: string, token: string): boolean {
  if (!token) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, "iu");
  return pattern.test(text);
}

export { parseRubricResultPayload };
