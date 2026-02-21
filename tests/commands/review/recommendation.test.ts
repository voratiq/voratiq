import { describe, expect, it } from "@jest/globals";

import {
  assertRecommendationMatchesRanking,
  parseReviewRecommendation,
} from "../../../src/commands/review/recommendation.js";

describe("review recommendation schema", () => {
  it("accepts singular preferred_agent shape", () => {
    const parsed = parseReviewRecommendation(
      JSON.stringify({
        preferred_agent: "r_aaaaaaaaaa",
        rationale: "Best option",
        next_actions: ["voratiq apply --run run-1 --agent r_aaaaaaaaaa"],
      }),
    );

    expect(parsed.preferred_agent).toBe("r_aaaaaaaaaa");
    expect(parsed.resolved_preferred_agent).toBeUndefined();
  });

  it("rejects missing preferred_agent", () => {
    expect(() =>
      parseReviewRecommendation(
        JSON.stringify({
          rationale: "Best option",
          next_actions: [],
        }),
      ),
    ).toThrow(/preferred_agent/u);
  });

  it("rejects empty preferred_agent", () => {
    expect(() =>
      parseReviewRecommendation(
        JSON.stringify({
          preferred_agent: "   ",
          rationale: "Best option",
          next_actions: [],
        }),
      ),
    ).toThrow(/preferred_agent/u);
  });
});

describe("recommendation ranking consistency", () => {
  it("accepts recommendation when preferred_agent matches ranking #1", () => {
    expect(() =>
      assertRecommendationMatchesRanking({
        recommendation: {
          preferred_agent: "r_aaaaaaaaaa",
          resolved_preferred_agent: "agent-a",
          rationale: "Best option",
          next_actions: [],
        },
        ranking: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
      }),
    ).not.toThrow();
  });

  it("rejects recommendation when preferred_agent differs from ranking #1", () => {
    expect(() =>
      assertRecommendationMatchesRanking({
        recommendation: {
          preferred_agent: "r_bbbbbbbbbb",
          rationale: "Best option",
          next_actions: [],
        },
        ranking: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
      }),
    ).toThrow(/ranking #1/u);
  });

  it("rejects empty ranking", () => {
    expect(() =>
      assertRecommendationMatchesRanking({
        recommendation: {
          preferred_agent: "r_bbbbbbbbbb",
          rationale: "Best option",
          next_actions: [],
        },
        ranking: [],
      }),
    ).toThrow(/Ranking must include at least one candidate/u);
  });
});
