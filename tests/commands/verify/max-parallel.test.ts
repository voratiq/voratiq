import { resolveVerifyRubricMaxParallel } from "../../../src/commands/verify/max-parallel.js";

describe("resolveVerifyRubricMaxParallel", () => {
  const verificationConfig = {
    spec: {
      programmatic: [],
      rubric: [{ template: "spec-verification" }],
    },
    run: {
      programmatic: [],
      rubric: [
        { template: "run-verification" },
        { template: "run-type" },
        { template: "failure-modes" },
      ],
    },
    reduce: {
      programmatic: [],
      rubric: [{ template: "reduce-verification" }],
    },
  } as const;

  it("defaults rubric parallelism to the flattened verifier-template execution count", () => {
    expect(
      resolveVerifyRubricMaxParallel({
        targetKind: "run",
        verificationConfig: verificationConfig as never,
        verifierAgentCount: 2,
      }),
    ).toBe(6);
  });

  it("caps requested maxParallel against the flattened verifier-template execution count", () => {
    expect(
      resolveVerifyRubricMaxParallel({
        targetKind: "run",
        verificationConfig: verificationConfig as never,
        verifierAgentCount: 2,
        requestedMaxParallel: 8,
      }),
    ).toBe(6);
  });

  it("returns zero when there are no rubric executions to run", () => {
    expect(
      resolveVerifyRubricMaxParallel({
        targetKind: "spec",
        verificationConfig: {
          ...verificationConfig,
          spec: { programmatic: [], rubric: [] },
        } as never,
        verifierAgentCount: 2,
      }),
    ).toBe(0);
  });
});
