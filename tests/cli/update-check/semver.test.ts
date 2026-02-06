import { describe, expect, it } from "@jest/globals";

import {
  isNewerVersion,
  parseSemver,
} from "../../../src/update-check/semver.js";

describe("parseSemver", () => {
  it("parses a standard version", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses a version with leading v", () => {
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("strips prerelease metadata", () => {
    expect(parseSemver("1.2.3-beta.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  it("strips build metadata", () => {
    expect(parseSemver("1.2.3+build.456")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  it("returns undefined for invalid strings", () => {
    expect(parseSemver("not-a-version")).toBeUndefined();
    expect(parseSemver("")).toBeUndefined();
    expect(parseSemver("1.2")).toBeUndefined();
    expect(parseSemver("unknown")).toBeUndefined();
  });
});

describe("isNewerVersion", () => {
  it("detects newer major version", () => {
    expect(isNewerVersion("0.4.9", "1.0.0")).toBe(true);
  });

  it("detects newer minor version", () => {
    expect(isNewerVersion("0.4.9", "0.5.0")).toBe(true);
  });

  it("detects newer patch version", () => {
    expect(isNewerVersion("0.5.0", "0.5.1")).toBe(true);
  });

  it("returns false for equal versions", () => {
    expect(isNewerVersion("0.5.0", "0.5.0")).toBe(false);
  });

  it("returns false for older candidate", () => {
    expect(isNewerVersion("0.5.0", "0.4.9")).toBe(false);
  });

  it("treats prerelease vs release as equal for notify purposes", () => {
    expect(isNewerVersion("0.5.0", "0.5.0-beta.1")).toBe(false);
    expect(isNewerVersion("0.5.0-beta.1", "0.5.0")).toBe(false);
  });

  it("returns false for invalid current version", () => {
    expect(isNewerVersion("unknown", "0.5.0")).toBe(false);
  });

  it("returns false for invalid candidate version", () => {
    expect(isNewerVersion("0.5.0", "invalid")).toBe(false);
  });

  it("returns false when both are invalid", () => {
    expect(isNewerVersion("invalid", "also-invalid")).toBe(false);
  });
});
