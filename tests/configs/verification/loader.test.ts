import { VerificationConfigError } from "../../../src/configs/verification/errors.js";
import { readVerificationConfig } from "../../../src/configs/verification/loader.js";

describe("verification config loader", () => {
  it("accepts run programmatic checks", () => {
    const config = readVerificationConfig(`
run:
  programmatic:
    lint: npm run lint
  rubric:
    - template: run-review
`);

    expect(config.run.programmatic).toEqual([
      { slug: "lint", command: "npm run lint" },
    ]);
    expect(config.run.rubric).toEqual([{ template: "run-review" }]);
  });

  it("accepts rubric entries without scope", () => {
    const config = readVerificationConfig(`
spec:
  rubric:
    - template: spec-review
run:
  rubric:
    - template: run-review
reduce:
  rubric:
    - template: reduce-review
`);

    expect(config.spec.rubric).toEqual([{ template: "spec-review" }]);
    expect(config.run.rubric).toEqual([{ template: "run-review" }]);
    expect(config.reduce.rubric).toEqual([{ template: "reduce-review" }]);
  });

  it("rejects rubric scope because it is no longer a supported config field", () => {
    expect(() =>
      readVerificationConfig(`
run:
  rubric:
    - template: run-review
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
