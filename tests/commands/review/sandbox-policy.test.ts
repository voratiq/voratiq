import { describe, expect, it } from "@jest/globals";

import { composeReviewSandboxPolicy } from "../../../src/commands/review/sandbox-policy.js";

describe("review sandbox policy composition", () => {
  it("forwards stage overlays without local dedupe or sorting", () => {
    const policy = composeReviewSandboxPolicy({
      stageWriteProtectedPaths: [
        "/repo/.voratiq/reviews/sessions/review-123/.shared",
        "/repo/.voratiq/specs",
        "/repo/.voratiq/specs",
      ],
      stageReadProtectedPaths: ["/repo/.git", "/repo/.git"],
    });

    expect(policy.extraWriteProtectedPaths).toEqual([
      "/repo/.voratiq/reviews/sessions/review-123/.shared",
      "/repo/.voratiq/specs",
      "/repo/.voratiq/specs",
    ]);
    expect(policy.extraReadProtectedPaths).toEqual([
      "/repo/.git",
      "/repo/.git",
    ]);
  });
});
