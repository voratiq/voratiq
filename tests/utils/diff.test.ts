import { describe, expect, it } from "@jest/globals";

import {
  formatCompactDiffStatistics,
  normalizeDiffStatistics,
} from "../../src/utils/diff.js";

describe("normalizeDiffStatistics", () => {
  it("trims whitespace and limits length", () => {
    const veryLong = `${" ".repeat(2)}${"a".repeat(300)}`;
    const normalized = normalizeDiffStatistics(veryLong);
    expect(normalized?.length).toBe(256);
    expect(normalized?.startsWith("a")).toBe(true);
  });

  it("returns undefined for non-string values", () => {
    expect(normalizeDiffStatistics(undefined)).toBeUndefined();
    expect(normalizeDiffStatistics(null)).toBeUndefined();
  });
});

describe("formatCompactDiffStatistics", () => {
  it("formats file/insert/delete counts into compact form", () => {
    const compact = formatCompactDiffStatistics(
      "3 files changed, 12 insertions(+), 2 deletions(-)",
    );
    expect(compact).toBe("3f +12/-2");
  });

  it("omits missing deltas", () => {
    expect(formatCompactDiffStatistics("1 file changed, 5 insertions(+)")).toBe(
      "1f +5",
    );
    expect(formatCompactDiffStatistics("2 files changed, 4 deletions(-)")).toBe(
      "2f -4",
    );
  });

  it("falls back to normalized value when parsing fails", () => {
    expect(formatCompactDiffStatistics("unexpected data")).toBe(
      "unexpected data",
    );
  });

  it("returns undefined for blank strings", () => {
    expect(formatCompactDiffStatistics("   ")).toBeUndefined();
  });
});
