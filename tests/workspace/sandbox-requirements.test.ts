import { expect } from "@jest/globals";

import {
  collectMissingSandboxDependencies,
  detectSandboxPlatform,
  formatSandboxDependencyList,
  hasSandboxDependencies,
  listSandboxDependencies,
} from "../../src/workspace/sandbox-requirements.js";

describe("workspace sandbox requirements", () => {
  const present = () => true;

  it("detects supported platforms", () => {
    expect(detectSandboxPlatform("darwin")).toBe("macos");
    expect(detectSandboxPlatform("linux")).toBe("linux");
    expect(detectSandboxPlatform("win32")).toBe("unsupported");
  });

  it("identifies missing macOS dependency", () => {
    const missing = collectMissingSandboxDependencies({
      platform: "darwin",
      commandExists: () => false,
    });
    expect(missing.map((entry) => entry.binary)).toEqual(["rg"]);
  });

  it("identifies missing Linux dependencies", () => {
    const missing = collectMissingSandboxDependencies({
      platform: "linux",
      commandExists: (binary) => binary === "rg",
    });
    expect(missing.map((entry) => entry.binary)).toEqual(["bwrap", "socat"]);
  });

  it("reports full dependency set for formatting", () => {
    const dependencies = listSandboxDependencies({ platform: "linux" });
    expect(formatSandboxDependencyList(dependencies)).toBe(
      "ripgrep (rg), bubblewrap (bwrap), socat",
    );
  });

  it("returns false when dependencies are missing or platform is unsupported", () => {
    expect(
      hasSandboxDependencies({
        platform: "darwin",
        commandExists: () => false,
        canBindLocalhost: () => true,
      }),
    ).toBe(false);
    expect(
      hasSandboxDependencies({
        platform: "win32",
        commandExists: present,
        canBindLocalhost: () => true,
      }),
    ).toBe(false);
  });

  it("returns true when all dependencies are present", () => {
    expect(
      hasSandboxDependencies({
        platform: "linux",
        commandExists: present,
        canBindLocalhost: () => true,
      }),
    ).toBe(true);
  });

  it("returns false when localhost binding is blocked", () => {
    expect(
      hasSandboxDependencies({
        platform: "linux",
        commandExists: present,
        canBindLocalhost: () => false,
      }),
    ).toBe(false);
  });
});
