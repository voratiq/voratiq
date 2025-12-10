const MAX_DIFF_STATISTICS_LENGTH = 256;
const FILES_CHANGED_PATTERN = /(\d+)\s+file/;
const INSERTIONS_PATTERN = /(\d+)\s+insertion/;
const DELETIONS_PATTERN = /(\d+)\s+deletion/;

/**
 * Normalize git shortstat output before persisting.
 * Trims surrounding whitespace and guards against oversized strings.
 */
export function normalizeDiffStatistics(
  value?: string | null,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.length > MAX_DIFF_STATISTICS_LENGTH) {
    return trimmed.slice(0, MAX_DIFF_STATISTICS_LENGTH);
  }

  return trimmed;
}

function extractStat(pattern: RegExp, input: string): number | undefined {
  const match = input.match(pattern);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Produce a compact representation such as `3f +12/-2` for the CHANGES column.
 */
export function formatCompactDiffStatistics(
  value?: string | null,
): string | undefined {
  const normalized = normalizeDiffStatistics(value);
  if (!normalized) {
    return undefined;
  }

  const files = extractStat(FILES_CHANGED_PATTERN, normalized);
  const insertions = extractStat(INSERTIONS_PATTERN, normalized);
  const deletions = extractStat(DELETIONS_PATTERN, normalized);

  if (
    files === undefined &&
    insertions === undefined &&
    deletions === undefined
  ) {
    return normalized;
  }

  const parts: string[] = [];
  if (files !== undefined) {
    parts.push(`${files}f`);
  }

  const delta: string[] = [];
  if (insertions !== undefined) {
    delta.push(`+${insertions}`);
  }
  if (deletions !== undefined) {
    delta.push(`-${deletions}`);
  }

  if (delta.length > 0) {
    parts.push(delta.join("/"));
  }

  return parts.join(" ") || normalized;
}
