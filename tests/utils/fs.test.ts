import { describe, expect, test } from "@jest/globals";

import { isMissing } from "../../src/utils/fs.js";

describe("isMissing", () => {
  test("returns true for ENOENT errors", () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";

    expect(isMissing(error)).toBe(true);
  });

  test("returns false for other errors", () => {
    const error = new Error("boom") as NodeJS.ErrnoException;
    error.code = "EACCES";

    expect(isMissing(error)).toBe(false);
    expect(isMissing(new Error("generic"))).toBe(false);
  });
});
