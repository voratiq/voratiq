import { describe, expect, it } from "@jest/globals";

import { composeReviewSandboxPolicy } from "../../../src/commands/review/sandbox-policy.js";

describe("review sandbox policy composition", () => {
  it("composes run-root and stage-level protected paths through one boundary", () => {
    const policy = composeReviewSandboxPolicy({
      runWorkspaceAbsolute: "/repo/.voratiq/runs/sessions/run-123",
      stageWriteProtectedPaths: [
        "/repo/.voratiq/runs/sessions/run-123",
        "/repo/.voratiq/specs",
      ],
      stageReadProtectedPaths: ["/repo/.git", "/repo/.git"],
    });

    expect(policy.extraWriteProtectedPaths).toEqual([
      "/repo/.voratiq/runs/sessions/run-123",
      "/repo/.voratiq/specs",
    ]);
    expect(policy.extraReadProtectedPaths).toEqual(["/repo/.git"]);
  });
});
