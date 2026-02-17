import { wrapWords } from "../../../src/render/utils/wrap.js";

describe("wrapWords", () => {
  it("wraps text at the provided width", () => {
    expect(wrapWords("alpha beta gamma delta", 11)).toEqual([
      "alpha beta",
      "gamma delta",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(wrapWords("   ", 79)).toEqual([]);
  });
});
