import {
  composeRestrictedEnvironment,
  filterEnvironmentVariables,
} from "../../src/utils/env.js";

describe("environment helpers", () => {
  it("filters host environment according to allowlists", () => {
    const sourceEnv = {
      PATH: "/bin",
      HOME: "/home/test",
      AWS_SECRET_ACCESS_KEY: "secret",
    };

    const filtered = filterEnvironmentVariables(sourceEnv);
    expect(filtered).toEqual({
      PATH: "/bin",
      HOME: "/home/test",
    });
    expect(filtered).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  it("merges overrides on top of restricted base env", () => {
    const base = {
      PATH: "/bin",
      HOME: "/home/test",
      AWS_PROFILE: "default",
    };

    const result = composeRestrictedEnvironment(
      { CUSTOM: "1" },
      { base, prefixes: ["VORATIQ_"] },
    );

    expect(result).toEqual({
      PATH: "/bin",
      HOME: "/home/test",
      CUSTOM: "1",
    });
    expect(result).not.toHaveProperty("AWS_PROFILE");
  });
});
