import { describe, expect, it } from "@jest/globals";

import { resolveBlindedRecommendation } from "../../../src/commands/review/blinded.js";
import { ReviewGenerationFailedError } from "../../../src/commands/review/errors.js";

describe("blinded review recommendation resolution", () => {
  it("keeps blinded preferred agents and writes resolved canonical ids", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        version: 1,
        preferred_agents: ["r_aaaaaaaaaa"],
        rationale: "none",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.preferred_agents).toEqual([
      "r_aaaaaaaaaa",
    ]);
    expect(resolution.recommendation.resolved_preferred_agents).toEqual([
      "agent-a",
    ]);
    expect(resolution.warnings ?? []).toEqual([]);
  });

  it("keeps reviewer-authored next actions unchanged", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        version: 1,
        preferred_agents: ["r_aaaaaaaaaa"],
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
        version: 1,
        preferred_agents: ["r_aaaaaaaaaa"],
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
        version: 1,
        preferred_agents: ["agent-a"],
        rationale: "already canonical",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.preferred_agents).toEqual(["agent-a"]);
    expect(resolution.recommendation.resolved_preferred_agents).toEqual([
      "agent-a",
    ]);
    expect(resolution.warnings).toBeDefined();
    expect(resolution.warnings?.[0]).toContain("Canonical agent id");
  });

  it("deduplicates resolved preferred agents", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a", r_bbbbbbbbbb: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        version: 1,
        preferred_agents: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
        rationale: "duplicates",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.preferred_agents).toEqual([
      "r_aaaaaaaaaa",
      "r_bbbbbbbbbb",
    ]);
    expect(resolution.recommendation.resolved_preferred_agents).toEqual([
      "agent-a",
    ]);
  });

  it("fails on unknown selectors", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    expect(() =>
      resolveBlindedRecommendation({
        recommendation: {
          version: 1,
          preferred_agents: ["r_bbbbbbbbbb"],
          rationale: "unknown",
          next_actions: [],
        },
        aliasMap,
      }),
    ).toThrow(ReviewGenerationFailedError);
  });

  it("overwrites reviewer-provided resolved_preferred_agents values", () => {
    const aliasMap = { r_aaaaaaaaaa: "agent-a" };
    const resolution = resolveBlindedRecommendation({
      recommendation: {
        version: 1,
        preferred_agents: ["r_aaaaaaaaaa"],
        resolved_preferred_agents: ["bogus-agent"],
        rationale: "tampered",
        next_actions: [],
      },
      aliasMap,
    });

    expect(resolution.recommendation.resolved_preferred_agents).toEqual([
      "agent-a",
    ]);
    expect(resolution.recommendation.resolved_preferred_agents).not.toContain(
      "bogus-agent",
    );
  });
});
