import {
  normalizeCandidateSelector,
  resolveCanonicalAgentId,
} from "./resolution.js";
import {
  buildResolvableSelectionDecision,
  buildUnresolvedSelectionDecision,
  type SelectionDecision,
  type SelectorResolutionMatch,
} from "./result.js";

export interface SelectorResolutionSourceInput {
  sourceId: string;
  aliasMap: Readonly<Record<string, string>>;
}

export interface SelectorResolutionInput {
  selector: string;
  canonicalAgentIds: readonly string[];
  sources: readonly SelectorResolutionSourceInput[];
}

export function deriveSelectorSelectionDecision(
  input: SelectorResolutionInput,
): SelectionDecision {
  const selector = normalizeCandidateSelector(input.selector) ?? "";

  const canonicalMatch = resolveCanonicalAgentId({
    selectors: [selector],
    canonicalAgentIds: input.canonicalAgentIds,
  });
  if (canonicalMatch) {
    return buildResolvableSelectionDecision(canonicalMatch);
  }

  const availableAliases = new Set<string>();
  const matchesByKey = new Map<string, SelectorResolutionMatch>();

  for (const source of input.sources) {
    for (const alias of Object.keys(source.aliasMap)) {
      availableAliases.add(alias);
    }

    const selectedCanonicalAgentId = resolveCanonicalAgentId({
      selectors: [selector],
      canonicalAgentIds: input.canonicalAgentIds,
      aliasMap: source.aliasMap,
    });
    if (!selectedCanonicalAgentId) {
      continue;
    }

    const match = {
      sourceId: source.sourceId,
      selectedCanonicalAgentId,
    };
    matchesByKey.set(
      `${match.sourceId}:${match.selectedCanonicalAgentId}`,
      match,
    );
  }

  const matches = Array.from(matchesByKey.values()).sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  );
  const uniqueMatches = new Set(
    matches.map((match) => match.selectedCanonicalAgentId),
  );

  if (uniqueMatches.size === 1) {
    const selectedCanonicalAgentId = matches[0]?.selectedCanonicalAgentId;
    if (selectedCanonicalAgentId) {
      return buildResolvableSelectionDecision(selectedCanonicalAgentId);
    }
  }

  if (uniqueMatches.size > 1) {
    return buildUnresolvedSelectionDecision([
      {
        code: "selector_ambiguous",
        selector,
        resolutions: matches,
      },
    ]);
  }

  return buildUnresolvedSelectionDecision([
    {
      code: "selector_unresolved",
      selector,
      availableCanonicalAgentIds: [...input.canonicalAgentIds],
      availableAliases: Array.from(availableAliases).sort((left, right) =>
        left.localeCompare(right),
      ),
    },
  ]);
}
