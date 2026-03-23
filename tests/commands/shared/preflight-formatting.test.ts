import { ReducePreflightError } from "../../../src/commands/reduce/errors.js";
import { RunPreflightError } from "../../../src/domains/runs/competition/errors.js";

describe("shared preflight issue formatting", () => {
  it("normalizes multiline issues consistently across run and reduce", () => {
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
    expect(reduceError.detailLines).toEqual([
      "- reducer-a: missing token",
      "- reducer-a: second line",
    ]);
  });

  it("uses the same truncation contract across run and reduce", () => {
    const longMessage = "x".repeat(200);
    const runError = new RunPreflightError([
      { agentId: "agent-a", message: longMessage },
    ]);
    const reduceError = new ReducePreflightError([
      { agentId: "reducer-a", message: longMessage },
    ]);

    expect(runError.detailLines[0]?.length).toBeLessThanOrEqual(120);
    expect(reduceError.detailLines[0]?.length).toBeLessThanOrEqual(120);
    expect(runError.hintLines).toEqual([
      "Run `voratiq init` to configure the workspace.",
    ]);
    expect(reduceError.hintLines).toEqual([
      "Run `voratiq init` to configure the workspace.",
    ]);
  });

  it("allows auth-only preflight errors to suppress the generic init hint", () => {
    const runError = new RunPreflightError(
      [
        {
          agentId: "agent-a",
          message:
            "Claude authentication failed. Authenticate directly via Claude before continuing.",
        },
      ],
      [],
    );
    const reduceError = new ReducePreflightError(
      [
        {
          agentId: "reducer-a",
          message:
            "Claude authentication failed. Authenticate directly via Claude before continuing.",
        },
      ],
      [],
    );

    expect(runError.hintLines).toEqual([]);
    expect(reduceError.hintLines).toEqual([]);
  });
});
