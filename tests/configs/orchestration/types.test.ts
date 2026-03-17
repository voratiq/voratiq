import { describe, expect, test } from "@jest/globals";

import {
  ORCHESTRATION_STAGE_IDS,
  orchestrationProfileSchema,
} from "../../../src/configs/orchestration/types.js";

describe("orchestration types", () => {
  test("includes reduce in the canonical orchestration stage ids", () => {
    expect(ORCHESTRATION_STAGE_IDS).toEqual([
      "run",
      "review",
      "spec",
      "reduce",
    ]);
  });

  test("requires reduce in orchestration profiles", () => {
    const result = orchestrationProfileSchema.safeParse({
      run: { agents: [] },
      review: { agents: [] },
      spec: { agents: [] },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.path).toEqual(["reduce"]);
  });
});
