import { describe, expect, it } from "@jest/globals";

import {
  collectRepeatedStringOption,
  parseMaxParallelOption,
} from "../../src/cli/option-parsers.js";

describe("cli option parsers", () => {
  it("collects repeatable string options preserving order", () => {
    expect(collectRepeatedStringOption("beta", ["alpha"])).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("parses max parallel values as positive integers", () => {
    expect(parseMaxParallelOption("3")).toBe(3);
  });

  it("rejects non-positive max parallel values", () => {
    expect(() => parseMaxParallelOption("0")).toThrow(
      "--max-parallel must be greater than 0",
    );
  });
});
