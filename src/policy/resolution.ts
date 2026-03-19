export function normalizeCandidateSelector(
  selector?: string,
): string | undefined {
  const normalized = selector?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function resolveCanonicalAgentId(options: {
  selectors: readonly (string | undefined)[];
  canonicalAgentIds: readonly string[];
  aliasMap?: Readonly<Record<string, string>>;
}): string | undefined {
  const { selectors, canonicalAgentIds, aliasMap } = options;
  const canonicalAgentSet = new Set(canonicalAgentIds);

  for (const selector of selectors) {
    const normalizedSelector = normalizeCandidateSelector(selector);
    if (!normalizedSelector) {
      continue;
    }

    if (canonicalAgentSet.has(normalizedSelector)) {
      return normalizedSelector;
    }

    const aliasedCanonicalAgentId = aliasMap?.[normalizedSelector];
    if (
      aliasedCanonicalAgentId &&
      canonicalAgentSet.has(aliasedCanonicalAgentId)
    ) {
      return aliasedCanonicalAgentId;
    }
  }

  return undefined;
}
