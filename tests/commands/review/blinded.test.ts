import { describe, expect, it } from "@jest/globals";

import { resolveBlindedRecommendation } from "../../../src/commands/review/blinded.js";
import { ReviewGenerationFailedError } from "../../../src/commands/review/errors.js";

describe("blinded review recommendation resolution", () => {
  it("keeps blinded preferred agent and writes resolved canonical id", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        preferred_agent: "r_aaaaaaaaaa",
        rationale: "none",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.preferred_agent).toBe("r_aaaaaaaaaa");
    expect(resolution.recommendation.resolved_preferred_agent).toBe("agent-a");
    expect(resolution.warnings ?? []).toEqual([]);
  });

  it("keeps reviewer-authored next actions unchanged", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        preferred_agent: "r_aaaaaaaaaa",
        rationale: "Use candidate",
        next_actions: ["voratiq apply --run run-1 --agent r_aaaaaaaaaa"],
      },
      aliasMap,
    });

    expect(resolution.recommendation.next_actions).toEqual([
      "voratiq apply --run run-1 --agent r_aaaaaaaaaa",
    ]);
  });

  it("keeps reviewer-authored rationale unchanged", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        preferred_agent: "r_aaaaaaaaaa",
        rationale: "Prefer r_aaaaaaaaaa for safety.",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.rationale).toBe(
      "Prefer r_aaaaaaaaaa for safety.",
    );
  });

  it("allows canonical tokens but emits a warning", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        preferred_agent: "agent-a",
        rationale: "already canonical",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.preferred_agent).toBe("agent-a");
    expect(resolution.recommendation.resolved_preferred_agent).toBe("agent-a");
    expect(resolution.warnings).toBeDefined();
    expect(resolution.warnings?.[0]).toContain("Canonical agent id");
  });

  it("fails on unknown selectors", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    expect(() =>
      resolveBlindedRecommendation({
        recommendation: {
          preferred_agent: "r_bbbbbbbbbb",
          rationale: "unknown",
          next_actions: [],
        },
        aliasMap,
      }),
    ).toThrow(ReviewGenerationFailedError);
  });

  it("overwrites reviewer-provided resolved_preferred_agent values", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        preferred_agent: "r_aaaaaaaaaa",
        resolved_preferred_agent: "bogus-agent",
        rationale: "tampered",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.resolved_preferred_agent).toBe("agent-a");
    expect(resolution.recommendation.resolved_preferred_agent).not.toBe(
      "bogus-agent",
    );
  });
});
