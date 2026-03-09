import { ReducePreflightError } from "../../../src/commands/reduce/errors.js";
import { ReviewPreflightError } from "../../../src/commands/review/errors.js";
import { RunPreflightError } from "../../../src/commands/run/errors.js";

describe("shared preflight issue formatting", () => {
  it("normalizes multiline issues consistently across run, review, and reduce", () => {
    const runError = new RunPreflightError([
      {
        agentId: "settings",
        message: "  bad settings  \n\n  second line  ",
      },
      {
        agentId: "agent-a",
        message: "  missing token  ",
      },
    ]);
    const reviewError = new ReviewPreflightError([
      {
        agentId: "reviewer-a",
        message: "  missing token  \n\n  second line  ",
      },
    ]);
    const reduceError = new ReducePreflightError([
      {
        agentId: "reducer-a",
        message: "  missing token  \n\n  second line  ",
      },
    ]);

    expect(runError.detailLines).toEqual([
      "- bad settings",
      "- second line",
      "- agent-a: missing token",
    ]);
    expect(reviewError.detailLines).toEqual([
      "- reviewer-a: missing token",
      "- reviewer-a: second line",
    ]);
    expect(reduceError.detailLines).toEqual([
      "- reducer-a: missing token",
      "- reducer-a: second line",
    ]);
  });

  it("uses the same truncation contract across run, review, and reduce", () => {
    const longMessage = "x".repeat(200);
    const runError = new RunPreflightError([
      { agentId: "agent-a", message: longMessage },
    ]);
    const reviewError = new ReviewPreflightError([
      { agentId: "reviewer-a", message: longMessage },
    ]);
    const reduceError = new ReducePreflightError([
      { agentId: "reducer-a", message: longMessage },
    ]);

    expect(runError.detailLines[0]?.length).toBeLessThanOrEqual(120);
    expect(reviewError.detailLines[0]?.length).toBeLessThanOrEqual(120);
    expect(reduceError.detailLines[0]?.length).toBeLessThanOrEqual(120);
    expect(runError.hintLines).toEqual([
      "Run `voratiq init` to configure the workspace.",
    ]);
    expect(reviewError.hintLines).toEqual([
      "Run `voratiq init` to configure the workspace.",
    ]);
    expect(reduceError.hintLines).toEqual([
      "Run `voratiq init` to configure the workspace.",
    ]);
  });
});
