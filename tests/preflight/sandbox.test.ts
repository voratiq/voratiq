import { expect, jest } from "@jest/globals";

import { SandboxDependenciesError } from "../../src/preflight/errors.js";
import { ensureSandboxDependencies } from "../../src/preflight/index.js";
import * as sandboxRequirements from "../../src/workspace/sandbox-requirements.js";

describe("ensureSandboxDependencies", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws when dependencies are missing", () => {
    jest
      .spyOn(sandboxRequirements, "collectMissingSandboxDependencies")
      .mockReturnValue([{ binary: "rg", displayName: "ripgrep (rg)" }]);

    expect(() => ensureSandboxDependencies()).toThrow(SandboxDependenciesError);
  });

  it("does nothing when all dependencies are present", () => {
    jest
      .spyOn(sandboxRequirements, "collectMissingSandboxDependencies")
      .mockReturnValue([]);

    expect(() => ensureSandboxDependencies()).not.toThrow();
  });
});
