import { VerificationConfigError } from "../../../src/configs/verification/errors.js";
import { readVerificationConfig } from "../../../src/configs/verification/loader.js";

describe("verification config loader", () => {
  it("accepts run programmatic checks", () => {
    const config = readVerificationConfig(`
run:
  programmatic:
    lint: npm run lint
  rubric:
    - template: run-verification
`);

    expect(config.run.programmatic).toEqual([
      { slug: "lint", command: "npm run lint" },
    ]);
    expect(config.run.rubric).toEqual([{ template: "run-verification" }]);
  });

  it("accepts non-legacy custom rubric templates", () => {
    const config = readVerificationConfig(`
run:
  rubric:
    - template: failure-modes
`);

    expect(config.run.rubric).toEqual([{ template: "failure-modes" }]);
  });

  it("accepts rubric entries without scope", () => {
    const config = readVerificationConfig(`
spec:
  rubric:
    - template: spec-verification
run:
  rubric:
    - template: run-verification
reduce:
  rubric:
    - template: reduce-verification
`);

    expect(config.spec.rubric).toEqual([{ template: "spec-verification" }]);
    expect(config.run.rubric).toEqual([{ template: "run-verification" }]);
    expect(config.reduce.rubric).toEqual([{ template: "reduce-verification" }]);
  });

  it("rejects rubric scope because it is no longer a supported config field", () => {
    expect(() =>
      readVerificationConfig(`
run:
  rubric:
    - template: run-verification
      scope: candidate
`),
    ).toThrow(VerificationConfigError);
  });

  it("rejects spec programmatic checks because spec verification is rubric-only", () => {
    expect(() =>
      readVerificationConfig(`
spec:
  programmatic:
    lint: npm run lint
`),
    ).toThrow(VerificationConfigError);
  });

  it("rejects reduce programmatic checks because reduce verification is rubric-only", () => {
    expect(() =>
      readVerificationConfig(`
reduce:
  programmatic:
    lint: npm run lint
`),
    ).toThrow(VerificationConfigError);
  });
});
