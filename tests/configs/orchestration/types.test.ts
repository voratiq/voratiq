import { describe, expect, test } from "@jest/globals";

import {
  ORCHESTRATION_STAGE_IDS,
  orchestrationProfileSchema,
} from "../../../src/configs/orchestration/types.js";

describe("orchestration types", () => {
  test("includes message in the canonical orchestration stage ids", () => {
    expect(ORCHESTRATION_STAGE_IDS).toEqual([
      "spec",
      "run",
      "reduce",
      "verify",
      "message",
    ]);
  });

  test("requires reduce in orchestration profiles", () => {
    const result = orchestrationProfileSchema.safeParse({
      run: { agents: [] },
      verify: { agents: [] },
      spec: { agents: [] },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.path).toEqual(["reduce"]);
  });
});
