import { ReducePreflightError } from "../../../src/commands/reduce/errors.js";
import { RunPreflightError } from "../../../src/domain/run/competition/errors.js";

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
      "Run `voratiq doctor --fix` to repair workspace setup.",
    ]);
    expect(reduceError.hintLines).toEqual([
      "Run `voratiq doctor --fix` to repair workspace setup.",
    ]);
  });

  it("uses a settings-specific hint when the preflight failure is only invalid settings", () => {
    const settingsIssue = [
      {
        agentId: "settings",
        message: "Invalid settings file at /repo/.voratiq/settings.yaml",
      },
    ];
    const runError = new RunPreflightError(settingsIssue, 1);
    const reduceError = new ReducePreflightError(settingsIssue, 1);

    expect(runError.hintLines).toEqual([
      "Review `.voratiq/settings.yaml` and correct invalid values.",
    ]);
    expect(reduceError.hintLines).toEqual([
      "Review `.voratiq/settings.yaml` and correct invalid values.",
    ]);
  });

  it("allows auth-only preflight errors to suppress the generic doctor hint", () => {
    const runError = new RunPreflightError(
      [
        {
          agentId: "agent-a",
          message:
            "Claude authentication failed. Authenticate directly via Claude before continuing.",
        },
      ],
      0,
    );
    const reduceError = new ReducePreflightError(
      [
        {
          agentId: "reducer-a",
          message:
            "Claude authentication failed. Authenticate directly via Claude before continuing.",
        },
      ],
      0,
    );

    expect(runError.hintLines).toEqual([]);
    expect(reduceError.hintLines).toEqual([]);
  });
});
