import { describe, expect, it } from "@jest/globals";

import {
  buildSandboxPolicy,
  normalizeFilesystemPolicy,
  normalizeNetworkPolicy,
} from "../../../src/agents/runtime/policy.js";

const ROOT = "/repo";
const WORKSPACE = "/repo/.voratiq/runs/sessions/run-123/codex/workspace";
const SANDBOX_HOME = "/repo/.voratiq/runs/sessions/run-123/codex/sandbox/home";
const RUNTIME_PATH = "/repo/.voratiq/runs/sessions/run-123/codex/runtime";
const ARTIFACTS_PATH = "/repo/.voratiq/runs/sessions/run-123/codex/artifacts";
const SETTINGS_PATH =
  "/repo/.voratiq/runs/sessions/run-123/codex/runtime/sandbox.json";

describe("sandbox policy normalization", () => {
  it("collapses parent+child deny entries per list", () => {
    const normalized = normalizeFilesystemPolicy({
      workspacePath: WORKSPACE,
      filesystem: {
        allowWrite: [],
        denyRead: [
          "/repo/.voratiq/runs",
          "/repo/.voratiq/runs/sessions/run-123",
          "/repo/.voratiq/runs",
        ],
        denyWrite: [
          "/repo/.voratiq/runs",
          "/repo/.voratiq/runs/sessions/run-123/codex",
        ],
      },
    });

    expect(normalized.denyRead).toEqual(["/repo/.voratiq/runs"]);
    expect(normalized.denyWrite).toEqual(["/repo/.voratiq/runs"]);
  });

  it("keeps boundary-safe siblings (/a/b does not collapse /a/bb)", () => {
    const normalized = normalizeFilesystemPolicy({
      workspacePath: WORKSPACE,
      filesystem: {
        allowWrite: [],
        denyRead: [],
        denyWrite: ["/a/b", "/a/bb", "/a/b/bc"],
      },
    });

    expect(normalized.denyWrite).toEqual(["/a/b", "/a/bb"]);
  });

  it("is list-local: allowWrite is not collapsed against deny lists", () => {
    const normalized = normalizeFilesystemPolicy({
      workspacePath: WORKSPACE,
      filesystem: {
        allowWrite: ["/repo/.voratiq/runs", "/repo/.voratiq/runs"],
        denyRead: ["/repo/.voratiq/runs", "/repo/.voratiq/runs/sessions"],
        denyWrite: ["/repo/.voratiq/runs", "/repo/.voratiq/runs/sessions"],
      },
    });

    expect(normalized.allowWrite).toEqual(["/repo/.voratiq/runs"]);
    expect(normalized.denyRead).toEqual(["/repo/.voratiq/runs"]);
    expect(normalized.denyWrite).toEqual(["/repo/.voratiq/runs"]);
  });

  it("normalizes relative inputs to absolute canonical paths", () => {
    const normalized = normalizeFilesystemPolicy({
      workspacePath: "/repo/workspace",
      filesystem: {
        allowWrite: ["./cache", "/tmp/../tmp/cache"],
        denyRead: ["../secrets", "/repo/workspace/../workspace/.hidden"],
        denyWrite: ["../secrets", "./cache/output"],
      },
    });

    expect(normalized.allowWrite).toEqual([
      "/tmp/cache",
      "/repo/workspace/cache",
    ]);
    expect(normalized.denyRead).toEqual([
      "/repo/secrets",
      "/repo/workspace/.hidden",
    ]);
    expect(normalized.denyWrite).toEqual([
      "/repo/secrets",
      "/repo/workspace/cache/output",
    ]);
  });

  it("is idempotent when normalization is applied multiple times", () => {
    const once = normalizeFilesystemPolicy({
      workspacePath: WORKSPACE,
      filesystem: {
        allowWrite: ["./b", "./a", "./a"],
        denyRead: ["/repo/.voratiq/runs", "/repo/.voratiq/runs/sessions/run-1"],
        denyWrite: [
          "/repo/.voratiq/runs/sessions/run-1",
          "/repo/.voratiq/runs",
        ],
      },
    });
    const twice = normalizeFilesystemPolicy({
      workspacePath: WORKSPACE,
      filesystem: once,
    });

    expect(twice).toEqual(once);
  });

  it("dedupes and normalizes network policy deterministically", () => {
    const normalized = normalizeNetworkPolicy({
      workspacePath: "/repo/workspace",
      network: {
        allowedDomains: ["z.example.com", "a.example.com", "a.example.com"],
        deniedDomains: ["b.example.com", "a.example.com", "b.example.com"],
        allowLocalBinding: false,
        allowUnixSockets: ["../sock", "/tmp/../tmp/sock", "/tmp/sock"],
      },
    });

    expect(normalized.allowedDomains).toEqual([
      "a.example.com",
      "z.example.com",
    ]);
    expect(normalized.deniedDomains).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
    expect(normalized.allowUnixSockets).toEqual(["/repo/sock", "/tmp/sock"]);
  });
});

describe("shared sandbox builder", () => {
  function build(stageId: "run" | "spec" | "review", overrides = {}) {
    return buildSandboxPolicy({
      stageId,
      root: ROOT,
      workspacePath: WORKSPACE,
      sandboxHomePath: SANDBOX_HOME,
      sandboxSettingsPath: SETTINGS_PATH,
      runtimePath: RUNTIME_PATH,
      artifactsPath: ARTIFACTS_PATH,
      repoRootPath: ROOT,
      providerFilesystem: {
        allowWrite: [],
        denyRead: [],
        denyWrite: [],
      },
      providerNetwork: {
        allowedDomains: ["b.example.com", "a.example.com"],
        deniedDomains: ["z.example.com", "z.example.com"],
        allowLocalBinding: false,
      },
      ...overrides,
    });
  }

  it("applies shared baseline by stage (run/spec/review) with deterministic keys", () => {
    const runPolicy = build("run");
    const specPolicy = build("spec");
    const reviewPolicy = build("review");

    expect(Object.keys(runPolicy.filesystem)).toEqual([
      "denyRead",
      "allowWrite",
      "denyWrite",
    ]);
    expect(runPolicy.filesystem.denyRead).toEqual(
      runPolicy.filesystem.denyWrite,
    );
    expect(runPolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        "/repo/.git",
        "/repo/.voratiq/runs/index.json",
        "/repo/.voratiq/runs/history.lock",
        "/repo/.voratiq/reviews",
      ]),
    );

    expect(specPolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining(["/repo/.voratiq/runs", "/repo/.voratiq/reviews"]),
    );
    expect(specPolicy.filesystem.denyRead).toEqual(
      specPolicy.filesystem.denyWrite,
    );

    expect(reviewPolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining(["/repo/.voratiq/runs", "/repo/.voratiq/specs"]),
    );
    expect(reviewPolicy.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/repo/.git"]),
    );
    expect(reviewPolicy.filesystem.denyWrite).not.toContain("/repo/.git");
  });

  it("collapses stage overlay child denies when baseline already denies parent", () => {
    const policy = build("review", {
      stageDenyWritePaths: ["/repo/.voratiq/runs/sessions/run-123"],
      stageDenyReadPaths: ["/repo/.voratiq/runs/sessions/run-123"],
    });

    expect(policy.filesystem.denyWrite).toContain("/repo/.voratiq/runs");
    expect(policy.filesystem.denyRead).toContain("/repo/.voratiq/runs");
    expect(policy.filesystem.denyWrite).not.toContain(
      "/repo/.voratiq/runs/sessions/run-123",
    );
    expect(policy.filesystem.denyRead).not.toContain(
      "/repo/.voratiq/runs/sessions/run-123",
    );
  });
});
