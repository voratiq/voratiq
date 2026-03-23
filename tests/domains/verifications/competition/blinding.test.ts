import { describe, expect, it } from "@jest/globals";

import {
  assertNoVerificationIdentityLeak,
  buildForbiddenVerificationIdentityTokens,
  overlapSafeAllowlist,
} from "../../../../src/domains/verifications/competition/blinding.js";
import type { ResolvedVerificationTarget } from "../../../../src/domains/verifications/competition/target.js";

function makeTarget(
  candidates: Array<{
    canonicalId: string;
    forbiddenIdentityTokens: string[];
  }>,
): ResolvedVerificationTarget {
  return {
    baseRevisionSha: "abc123",
    competitiveCandidates: candidates,
    target: { kind: "run", sessionId: "run-1", candidateIds: [] },
    runRecord: {} as ResolvedVerificationTarget extends { runRecord: infer R }
      ? R
      : never,
  } as ResolvedVerificationTarget;
}

describe("overlapSafeAllowlist", () => {
  it("allows tokens not present in candidate set", () => {
    const candidateTokens = new Set(["candidate-a", "model-x"]);
    const result = overlapSafeAllowlist(
      ["verifier-z", "model-y"],
      candidateTokens,
    );
    expect(result).toEqual(new Set(["verifier-z", "model-y"]));
  });

  it("removes tokens that overlap with candidate set", () => {
    const candidateTokens = new Set(["shared-agent", "model-x"]);
    const result = overlapSafeAllowlist(
      ["shared-agent", "model-y"],
      candidateTokens,
    );
    expect(result).toEqual(new Set(["model-y"]));
  });

  it("removes all tokens when all overlap", () => {
    const candidateTokens = new Set(["shared-agent", "shared-model"]);
    const result = overlapSafeAllowlist(
      ["shared-agent", "shared-model"],
      candidateTokens,
    );
    expect(result).toEqual(new Set());
  });

  it("normalizes tokens to lowercase and trimmed form", () => {
    const candidateTokens = new Set(["agent-a"]);
    const result = overlapSafeAllowlist(["  Agent-A  "], candidateTokens);
    expect(result).toEqual(new Set());
  });

  it("filters out empty and whitespace-only tokens", () => {
    const candidateTokens = new Set<string>();
    const result = overlapSafeAllowlist(["", "  ", "valid"], candidateTokens);
    expect(result).toEqual(new Set(["valid"]));
  });
});

describe("buildForbiddenVerificationIdentityTokens", () => {
  it("returns all candidate tokens when no allowlist is provided", () => {
    const target = makeTarget([
      { canonicalId: "agent-a", forbiddenIdentityTokens: ["agent-a"] },
      {
        canonicalId: "agent-b",
        forbiddenIdentityTokens: ["agent-b", "model-x"],
      },
    ]);
    const result = buildForbiddenVerificationIdentityTokens({
      resolvedTarget: target,
    });
    expect(result.sort()).toEqual(["agent-a", "agent-b", "model-x"]);
  });

  describe("no-overlap self allowlist remains permitted", () => {
    it("removes verifier self-identity tokens that do not overlap with candidates", () => {
      const target = makeTarget([
        { canonicalId: "agent-a", forbiddenIdentityTokens: ["agent-a"] },
        { canonicalId: "agent-b", forbiddenIdentityTokens: ["agent-b"] },
      ]);
      const result = buildForbiddenVerificationIdentityTokens({
        resolvedTarget: target,
        allowed: ["verifier-z", "model-y"],
      });
      // verifier-z and model-y are not candidate tokens, so they are allowlisted
      // and would not appear in forbidden. But they weren't candidate tokens to
      // begin with, so the result is just the candidate tokens.
      expect(result.sort()).toEqual(["agent-a", "agent-b"]);
    });
  });

  describe("verifier id overlaps candidate id", () => {
    it("keeps overlapping verifier id as forbidden", () => {
      const target = makeTarget([
        { canonicalId: "agent-a", forbiddenIdentityTokens: ["agent-a"] },
        {
          canonicalId: "agent-b",
          forbiddenIdentityTokens: ["agent-b", "model-x"],
        },
      ]);
      // The verifier's agent id is "agent-a", which is also a candidate.
      const result = buildForbiddenVerificationIdentityTokens({
        resolvedTarget: target,
        allowed: ["agent-a", "model-y"],
      });
      // agent-a must remain forbidden because it overlaps with candidate-a
      // model-y is allowlisted (no overlap), but it's not a candidate token anyway
      expect(result.sort()).toEqual(["agent-a", "agent-b", "model-x"]);
    });
  });

  describe("verifier model overlaps candidate model", () => {
    it("keeps overlapping verifier model as forbidden", () => {
      const target = makeTarget([
        {
          canonicalId: "agent-a",
          forbiddenIdentityTokens: ["agent-a", "model-x"],
        },
        {
          canonicalId: "agent-b",
          forbiddenIdentityTokens: ["agent-b", "model-x"],
        },
      ]);
      // The verifier's model is "model-x", which is also a candidate token.
      const result = buildForbiddenVerificationIdentityTokens({
        resolvedTarget: target,
        allowed: ["verifier-z", "model-x"],
      });
      // model-x must remain forbidden because it overlaps with a candidate token
      expect(result.sort()).toEqual(["agent-a", "agent-b", "model-x"]);
    });
  });

  describe("overlap tokens are still detected as leaks", () => {
    it("detects leaked overlapping identity in verifier output", () => {
      const target = makeTarget([
        {
          canonicalId: "agent-a",
          forbiddenIdentityTokens: ["agent-a", "gpt-5"],
        },
        { canonicalId: "agent-b", forbiddenIdentityTokens: ["agent-b"] },
      ]);

      // Verifier IS agent-a using gpt-5, both overlap with candidate tokens.
      const forbidden = buildForbiddenVerificationIdentityTokens({
        resolvedTarget: target,
        allowed: ["agent-a", "gpt-5"],
      });

      // Both agent-a and gpt-5 should remain forbidden due to overlap.
      expect(forbidden).toContain("agent-a");
      expect(forbidden).toContain("gpt-5");

      // Leakage detection should catch these in verifier output.
      expect(() =>
        assertNoVerificationIdentityLeak({
          text: "The best candidate is agent-a using gpt-5.",
          forbidden,
        }),
      ).toThrow(/forbidden candidate identity token/);
    });
  });

  it("handles mixed overlap and non-overlap correctly", () => {
    const target = makeTarget([
      {
        canonicalId: "agent-a",
        forbiddenIdentityTokens: ["agent-a", "model-shared"],
      },
      { canonicalId: "agent-b", forbiddenIdentityTokens: ["agent-b"] },
    ]);
    // Verifier id is "verifier-z" (no overlap), model is "model-shared" (overlaps).
    const result = buildForbiddenVerificationIdentityTokens({
      resolvedTarget: target,
      allowed: ["verifier-z", "model-shared"],
    });
    // model-shared must remain forbidden due to overlap.
    // verifier-z is truly allowlisted (no overlap) but wasn't a candidate token.
    expect(result.sort()).toEqual(["agent-a", "agent-b", "model-shared"]);
  });

  it("handles case-insensitive overlap detection", () => {
    const target = makeTarget([
      { canonicalId: "Agent-A", forbiddenIdentityTokens: ["Agent-A"] },
    ]);
    const result = buildForbiddenVerificationIdentityTokens({
      resolvedTarget: target,
      allowed: ["agent-a"],
    });
    // "agent-a" overlaps with "Agent-A" after normalization.
    expect(result).toEqual(["agent-a"]);
  });

  it("returns empty array for no candidates", () => {
    const target = makeTarget([]);
    const result = buildForbiddenVerificationIdentityTokens({
      resolvedTarget: target,
      allowed: ["verifier-z"],
    });
    expect(result).toEqual([]);
  });
});
