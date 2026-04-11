import { describe, expect, it } from "@jest/globals";

import { deriveReductionStatusFromReducers } from "../../../../src/domain/reduce/competition/finalize.js";
import type { ReductionRecord } from "../../../../src/domain/reduce/model/types.js";

function reducerWithStatus(
  status: ReductionRecord["reducers"][number]["status"],
): Pick<ReductionRecord["reducers"][number], "status"> {
  return { status };
}

describe("deriveReductionStatusFromReducers", () => {
  it("returns succeeded when at least one reducer succeeds", () => {
    expect(
      deriveReductionStatusFromReducers([
        reducerWithStatus("failed"),
        reducerWithStatus("succeeded"),
      ]),
    ).toBe("succeeded");
  });

  it("returns failed when no reducers succeed", () => {
    expect(
      deriveReductionStatusFromReducers([
        reducerWithStatus("failed"),
        reducerWithStatus("aborted"),
      ]),
    ).toBe("failed");
  });

  it("returns aborted when all terminal reducers are aborted", () => {
    expect(
      deriveReductionStatusFromReducers([
        reducerWithStatus("aborted"),
        reducerWithStatus("aborted"),
      ]),
    ).toBe("aborted");
  });
});
