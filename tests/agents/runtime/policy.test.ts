import { describe, expect, it } from "@jest/globals";

import { SANDBOX_STAGE_IDS } from "../../../src/agents/runtime/operator-access.js";
import {
  buildSandboxPolicy,
  normalizeFilesystemPolicy,
  normalizeNetworkPolicy,
} from "../../../src/agents/runtime/policy.js";

const ROOT = "/repo";
const WORKSPACE = "/repo/.voratiq/run/sessions/run-123/codex/workspace";
const SANDBOX_HOME = "/repo/.voratiq/run/sessions/run-123/codex/sandbox/home";
const RUNTIME_PATH = "/repo/.voratiq/run/sessions/run-123/codex/runtime";
const ARTIFACTS_PATH = "/repo/.voratiq/run/sessions/run-123/codex/artifacts";
const SETTINGS_PATH =
  "/repo/.voratiq/run/sessions/run-123/codex/runtime/sandbox.json";

describe("sandbox policy normalization", () => {
  it("keeps sandbox stage ids in canonical operator order", () => {
    expect(SANDBOX_STAGE_IDS).toEqual([
      "spec",
      "run",
      "reduce",
      "verify",
      "message",
    ]);
  });

  it("collapses parent+child deny entries per list", () => {
    const normalized = normalizeFilesystemPolicy({
      workspacePath: WORKSPACE,
      filesystem: {
        allowWrite: [],
        denyRead: [
          "/repo/.voratiq/run",
          "/repo/.voratiq/run/sessions/run-123",
          "/repo/.voratiq/run",
        ],
        denyWrite: [
          "/repo/.voratiq/run",
          "/repo/.voratiq/run/sessions/run-123/codex",
        ],
      },
    });

    expect(normalized.denyRead).toEqual(["/repo/.voratiq/run"]);
    expect(normalized.denyWrite).toEqual(["/repo/.voratiq/run"]);
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
        allowWrite: ["/repo/.voratiq/run", "/repo/.voratiq/run"],
        denyRead: ["/repo/.voratiq/run", "/repo/.voratiq/run/sessions"],
        denyWrite: ["/repo/.voratiq/run", "/repo/.voratiq/run/sessions"],
      },
    });

    expect(normalized.allowWrite).toEqual(["/repo/.voratiq/run"]);
    expect(normalized.denyRead).toEqual(["/repo/.voratiq/run"]);
    expect(normalized.denyWrite).toEqual(["/repo/.voratiq/run"]);
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
        denyRead: ["/repo/.voratiq/run", "/repo/.voratiq/run/sessions/run-1"],
        denyWrite: ["/repo/.voratiq/run/sessions/run-1", "/repo/.voratiq/run"],
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
  function build(
    stageId: "run" | "spec" | "message" | "reduce" | "verify",
    overrides = {},
  ) {
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

  it("applies shared baseline by stage with explicit operator cases", () => {
    const runPolicy = build("run");
    const specPolicy = build("spec");
    const messagePolicy = build("message");
    const reducePolicy = build("reduce");
    const verifyPolicy = build("verify");

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
        "/repo/.voratiq/run/index.json",
        "/repo/.voratiq/run/history.lock",
        "/repo/.voratiq/verify",
      ]),
    );
    expect(runPolicy.filesystem.denyRead).not.toContain("/repo/dist");

    expect(specPolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        "/repo/.voratiq/run",
        "/repo/.voratiq/verify",
        "/repo/.voratiq/reduce",
      ]),
    );
    expect(specPolicy.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/repo/.git"]),
    );
    expect(specPolicy.filesystem.denyWrite).not.toContain("/repo/.git");

    expect(messagePolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining(["/repo/.voratiq/run", "/repo/.voratiq/spec"]),
    );
    expect(messagePolicy.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/repo/.git"]),
    );
    expect(messagePolicy.filesystem.denyWrite).not.toContain("/repo/.git");

    expect(reducePolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining(["/repo/.voratiq/run", "/repo/.voratiq/spec"]),
    );
    expect(reducePolicy.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/repo/.git"]),
    );
    expect(reducePolicy.filesystem.denyWrite).not.toContain("/repo/.git");
    expect(reducePolicy.filesystem.denyRead).not.toContain("/repo/dist");

    expect(verifyPolicy.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        "/repo/.voratiq/run",
        "/repo/.voratiq/spec",
        "/repo/.voratiq/reduce",
      ]),
    );
    expect(verifyPolicy.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/repo/.git"]),
    );
    expect(verifyPolicy.filesystem.denyWrite).not.toContain("/repo/.git");
    expect(verifyPolicy.filesystem.denyRead).not.toContain("/repo/dist");
  });

  it("collapses stage overlay child denies when baseline already denies parent", () => {
    const policy = build("verify", {
      stageDenyWritePaths: ["/repo/.voratiq/run/sessions/run-123"],
      stageDenyReadPaths: ["/repo/.voratiq/run/sessions/run-123"],
    });

    expect(policy.filesystem.denyWrite).toContain("/repo/.voratiq/run");
    expect(policy.filesystem.denyRead).toContain("/repo/.voratiq/run");
    expect(policy.filesystem.denyWrite).not.toContain(
      "/repo/.voratiq/run/sessions/run-123",
    );
    expect(policy.filesystem.denyRead).not.toContain(
      "/repo/.voratiq/run/sessions/run-123",
    );
  });
});
