import { describe, expect, it } from "@jest/globals";

import {
  BLINDED_ALIAS_PATTERN,
  generateBlindedCandidateAlias,
} from "../../src/reviews/candidates.js";

describe("blinded candidate aliases", () => {
  it("generates aliases matching the required format", () => {
    const alias = generateBlindedCandidateAlias({ seen: new Set() });
    expect(alias).toMatch(BLINDED_ALIAS_PATTERN);
  });

  it("generates unique aliases within a session", () => {
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const alias = generateBlindedCandidateAlias({ seen });
      expect(seen.has(alias)).toBe(false);
      seen.add(alias);
      aliases.push(alias);
    }

    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("supports 10-16 character suffixes", () => {
    const a10 = generateBlindedCandidateAlias({ seen: new Set(), length: 10 });
    const a16 = generateBlindedCandidateAlias({ seen: new Set(), length: 16 });
    expect(a10).toMatch(BLINDED_ALIAS_PATTERN);
    expect(a16).toMatch(BLINDED_ALIAS_PATTERN);
  });

  it("rejects invalid lengths", () => {
    expect(() =>
      generateBlindedCandidateAlias({ seen: new Set(), length: 9 }),
    ).toThrow();
    expect(() =>
      generateBlindedCandidateAlias({ seen: new Set(), length: 17 }),
    ).toThrow();
  });
});
