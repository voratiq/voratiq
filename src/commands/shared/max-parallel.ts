export interface ResolveEffectiveMaxParallelOptions {
  competitorCount: number;
  requestedMaxParallel?: number;
}

export function resolveEffectiveMaxParallel(
  options: ResolveEffectiveMaxParallelOptions,
): number {
  const { competitorCount, requestedMaxParallel } = options;

  if (!Number.isInteger(competitorCount) || competitorCount < 0) {
    throw new Error("competitorCount must be a non-negative integer");
  }

  if (competitorCount === 0) {
    return 0;
  }

  if (
    requestedMaxParallel !== undefined &&
    (!Number.isInteger(requestedMaxParallel) || requestedMaxParallel <= 0)
  ) {
    throw new Error("requestedMaxParallel must be a positive integer");
  }

  const resolved =
    requestedMaxParallel !== undefined ? requestedMaxParallel : competitorCount;
  return Math.min(competitorCount, Math.max(1, resolved));
}
