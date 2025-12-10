import { readEvalsConfig } from "../../src/configs/evals/loader.js";

describe("readEvalsConfig", () => {
  it("trims commands and preserves declared order", () => {
    const config = readEvalsConfig(
      [
        "format: npm run format:check",
        "lint:  npm run lint  ",
        "typecheck:",
        "tests: npm run test",
        "mandoline.pattern-adherence: echo ok",
      ].join("\n"),
    );

    expect(config.map((entry) => entry.slug)).toEqual([
      "format",
      "lint",
      "typecheck",
      "tests",
      "mandoline.pattern-adherence",
    ]);
    expect(config[0]?.command).toBe("npm run format:check");
    expect(config[1]?.command).toBe("npm run lint");
    expect(config[2]?.command).toBeUndefined();
    expect(config[3]?.command).toBe("npm run test");
    expect(config[4]?.command).toBe("echo ok");
  });

  it("throws when slugs are invalid", () => {
    expect(() => readEvalsConfig("Invalid Slug: npm test")).toThrow(
      /eval slug must contain only lowercase letters/i,
    );
  });
});
