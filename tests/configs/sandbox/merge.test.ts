import { describe, expect, it } from "@jest/globals";

import {
  mergeFilesystemConfig,
  mergeNetworkConfig,
  mergeUniqueStrings,
} from "../../../src/configs/sandbox/merge.js";
import type {
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
} from "../../../src/configs/sandbox/types.js";

describe("mergeNetworkConfig", () => {
  it("overrides and deduplicates domain lists", () => {
    const base: SandboxNetworkConfig = {
      allowedDomains: ["alpha.com"],
      deniedDomains: ["deny.me"],
      allowLocalBinding: false,
    };

    const merged = mergeNetworkConfig(base, {
      allowedDomains: ["alpha.com", "beta.com"],
      deniedDomains: ["blocked.io"],
      allowLocalBinding: true,
      allowUnixSockets: ["/tmp/socket"],
      allowAllUnixSockets: true,
    });

    expect(merged.allowedDomains).toEqual(["alpha.com", "beta.com"]);
    expect(merged.deniedDomains).toEqual(["deny.me", "blocked.io"]);
    expect(merged.allowLocalBinding).toBe(true);
    expect(merged.allowUnixSockets).toEqual(["/tmp/socket"]);
    expect(merged.allowAllUnixSockets).toBe(true);
  });
});

describe("mergeFilesystemConfig", () => {
  it("combines allowWrite/deny lists without mutating base", () => {
    const base: SandboxFilesystemConfig = {
      allowWrite: ["/data"],
      denyRead: [],
      denyWrite: [],
    };

    const merged = mergeFilesystemConfig(base, {
      allowWrite: ["/data", "/logs"],
      denyRead: ["/secret"],
    });

    expect(merged.allowWrite).toEqual(["/data", "/logs"]);
    expect(base.allowWrite).toEqual(["/data"]);
    expect(merged.denyRead).toEqual(["/secret"]);
  });
});

describe("mergeUniqueStrings", () => {
  it("deduplicates while preserving order", () => {
    expect(mergeUniqueStrings(["a", "b", "a"], ["b", "c", "a", "d"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
