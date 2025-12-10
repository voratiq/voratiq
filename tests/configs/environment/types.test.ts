import { describe, expect, it } from "@jest/globals";

import {
  environmentNodeConfigSchema,
  environmentPythonConfigSchema,
} from "../../../src/configs/environment/types.js";

describe("environment config schemas", () => {
  it("accepts repo-relative node dependency roots", () => {
    const result = environmentNodeConfigSchema.safeParse({
      dependencyRoots: ["node_modules", "packages/shared/node_modules"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects absolute node dependency roots", () => {
    const result = environmentNodeConfigSchema.safeParse({
      dependencyRoots: ["/tmp"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      'Invalid node.dependencyRoots[] "/tmp"',
    );
  });

  it("rejects parent-traversing node dependency roots", () => {
    const result = environmentNodeConfigSchema.safeParse({
      dependencyRoots: ["../outside"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("../outside");
  });

  it("rejects Windows absolute node dependency roots", () => {
    const result = environmentNodeConfigSchema.safeParse({
      dependencyRoots: ["C:\\\\windows"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("C:\\\\windows");
  });

  it("accepts repo-relative python paths", () => {
    const result = environmentPythonConfigSchema.safeParse({
      path: "envs/test/.venv",
    });
    expect(result.success).toBe(true);
  });

  it("rejects absolute python paths", () => {
    const result = environmentPythonConfigSchema.safeParse({
      path: "/tmp/.venv",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('"/tmp/.venv"');
  });

  it("rejects blank python paths", () => {
    const result = environmentPythonConfigSchema.safeParse({
      path: "",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      'Invalid python.path "<empty>"',
    );
  });
});
