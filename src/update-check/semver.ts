/**
 * Lightweight semver comparison for update-check.
 * Ignores prerelease/build metadata per MVP spec.
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(version: string): ParsedVersion | undefined {
  // Strip leading 'v' if present, then strip prerelease/build metadata
  const cleaned = version.startsWith("v") ? version.slice(1) : version;
  const coreMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  if (!coreMatch) {
    return undefined;
  }

  return {
    major: Number(coreMatch[1]),
    minor: Number(coreMatch[2]),
    patch: Number(coreMatch[3]),
  };
}

/**
 * Returns true when `candidate` is strictly newer than `current`.
 * Prerelease/build metadata is stripped before comparison.
 * Returns false for invalid version strings.
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(candidate);
  if (!a || !b) {
    return false;
  }

  if (b.major !== a.major) {
    return b.major > a.major;
  }
  if (b.minor !== a.minor) {
    return b.minor > a.minor;
  }
  return b.patch > a.patch;
}
