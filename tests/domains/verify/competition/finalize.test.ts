import { describe, expect, it } from "@jest/globals";

import { deriveVerificationStatusFromMethods } from "../../../../src/domain/verify/competition/finalize.js";
import type { VerificationMethodResultRef } from "../../../../src/domain/verify/model/types.js";

function methodWithStatus(
  status: VerificationMethodResultRef["status"],
): VerificationMethodResultRef {
  return {
    method: "programmatic",
    slug: "programmatic",
    scope: { kind: "target" },
    status,
  };
}

describe("deriveVerificationStatusFromMethods", () => {
  it("returns succeeded when there are no terminal methods yet", () => {
    expect(deriveVerificationStatusFromMethods([])).toBe("succeeded");
  });

  it("returns succeeded when at least one method succeeds", () => {
    expect(
      deriveVerificationStatusFromMethods([
        methodWithStatus("failed"),
        methodWithStatus("succeeded"),
        methodWithStatus("aborted"),
      ]),
    ).toBe("succeeded");
  });

  it("returns failed when no methods succeed and at least one fails", () => {
    expect(
      deriveVerificationStatusFromMethods([
        methodWithStatus("failed"),
        methodWithStatus("aborted"),
      ]),
    ).toBe("failed");
  });

  it("returns aborted when all terminal methods are aborted", () => {
    expect(
      deriveVerificationStatusFromMethods([
        methodWithStatus("aborted"),
        methodWithStatus("aborted"),
      ]),
    ).toBe("aborted");
  });
});
