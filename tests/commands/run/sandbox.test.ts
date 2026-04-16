import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  checkPlatformSupport,
  generateSandboxSettings,
  resolveSrtBinary,
  type SandboxSettings,
  writeSandboxSettings,
} from "../../../src/agents/runtime/sandbox.js";
import {
  VORATIQ_AGENTS_FILE,
  VORATIQ_ENVIRONMENT_FILE,
  VORATIQ_HISTORY_LOCK_FILENAME,
  VORATIQ_ORCHESTRATION_FILE,
  VORATIQ_RUN_DIR,
  VORATIQ_RUN_FILE,
  VORATIQ_SANDBOX_FILE,
  VORATIQ_VERIFICATION_DIR,
} from "../../../src/workspace/constants.js";
import { resolveWorkspacePath } from "../../../src/workspace/path-resolvers.js";
import { clearSandboxConfigurationCache } from "../../support/hooks/sandbox-loader.js";

const DEFAULT_ALLOWED_DOMAINS = ["*"];
describe("sandbox", () => {
  describe("generateSandboxSettings", () => {
    const sandboxHomePath = "/run/agent/sandbox";
    const workspacePath = "/run/agent/workspace";
    const runtimePath = "/run/agent/runtime";
    const sandboxSettingsPath = `${runtimePath}/sandbox.json`;
    const artifactsPath = "/run/agent/artifacts";
    const protectedPath = "/run/agent/protected";
    beforeEach(() => {
      clearSandboxConfigurationCache();
    });

    async function setupSandboxConfig(content: string): Promise<{
      root: string;
      cleanup: () => Promise<void>;
    }> {
      const root = await mkdtemp(join(tmpdir(), "voratiq-sandbox-"));
      const configDir = join(root, ".voratiq");
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, "sandbox.yaml"), content, "utf8");

      return {
        root,
        cleanup: () => rm(root, { recursive: true, force: true }),
      };
    }

    function expectedRunBaselinePaths(root: string): string[] {
      return [
        join(root, ".git"),
        resolveWorkspacePath(root, VORATIQ_AGENTS_FILE),
        resolveWorkspacePath(root, VORATIQ_ENVIRONMENT_FILE),
        resolveWorkspacePath(root, VORATIQ_ORCHESTRATION_FILE),
        resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE),
        resolveWorkspacePath(root, VORATIQ_RUN_FILE),
        resolveWorkspacePath(
          root,
          VORATIQ_RUN_DIR,
          VORATIQ_HISTORY_LOCK_FILENAME,
        ),
        resolveWorkspacePath(root, VORATIQ_VERIFICATION_DIR),
      ];
    }

    test("injects runtime paths while using provider defaults", async () => {
      const { root, cleanup } = await setupSandboxConfig("providers: {}\n");

      try {
        const settings = generateSandboxSettings({
          sandboxHomePath,
          workspacePath,
          providerId: "codex",
          root,
          sandboxSettingsPath,
          runtimePath,
          artifactsPath,
          extraWriteProtectedPaths: [protectedPath],
          extraReadProtectedPaths: [protectedPath],
        });

        expect(settings.network).toEqual({
          allowedDomains: [
            "ab.chatgpt.com",
            "api.openai.com",
            "auth.openai.com",
            "chatgpt.com",
          ],
          deniedDomains: [],
        });
        const baseline = expectedRunBaselinePaths(root);
        expect(settings.filesystem.denyRead).toEqual(
          expect.arrayContaining([...baseline, artifactsPath, protectedPath]),
        );
        expect(settings.filesystem.denyWrite).toEqual(
          expect.arrayContaining([...baseline, artifactsPath, protectedPath]),
        );
        expect(settings.filesystem.denyRead).toEqual(
          settings.filesystem.denyWrite,
        );
        expect(settings.filesystem.denyWrite).not.toContain(runtimePath);
        expect(new Set(settings.filesystem.allowWrite)).toEqual(
          new Set([sandboxHomePath, workspacePath]),
        );
      } finally {
        await cleanup();
      }
    });

    test("fails when sandbox configuration is invalid", async () => {
      const config = `providers:\n  claude:\n    allowedDomains: []\n`;
      const { root, cleanup } = await setupSandboxConfig(config);

      try {
        expect(() =>
          generateSandboxSettings({
            sandboxHomePath,
            workspacePath,
            providerId: "claude",
            root,
            sandboxSettingsPath,
            runtimePath,
            artifactsPath,
            extraWriteProtectedPaths: [protectedPath],
            extraReadProtectedPaths: [protectedPath],
          }),
        ).toThrow(/Invalid `sandbox\.yaml`/u);
      } finally {
        await cleanup();
      }
    });

    test("applies provider overrides from sandbox.yaml", async () => {
      const config = `providers:\n  claude:\n    allowedDomains:\n      - allowed.example.com\n    deniedDomains:\n      - blocked.example.com\n`;
      const { root, cleanup } = await setupSandboxConfig(config);

      try {
        const settings = generateSandboxSettings({
          sandboxHomePath,
          workspacePath,
          providerId: "claude",
          root,
          sandboxSettingsPath,
          runtimePath,
          artifactsPath,
          extraWriteProtectedPaths: [protectedPath],
          extraReadProtectedPaths: [protectedPath],
        });

        expect(settings.network.allowedDomains).toEqual([
          "allowed.example.com",
          "api.anthropic.com",
          "console.anthropic.com",
          "mcp-proxy.anthropic.com",
          "platform.claude.com",
        ]);
        expect(settings.network.deniedDomains).toEqual(["blocked.example.com"]);
      } finally {
        await cleanup();
      }
    });

    test("applies unix socket overrides", async () => {
      const config = `providers:\n  codex:\n    allowUnixSockets:\n      - /var/run/docker.sock\n`;
      const { root, cleanup } = await setupSandboxConfig(config);

      try {
        const settings = generateSandboxSettings({
          sandboxHomePath,
          workspacePath,
          providerId: "codex",
          root,
          sandboxSettingsPath,
          runtimePath,
          artifactsPath,
          extraWriteProtectedPaths: [protectedPath],
          extraReadProtectedPaths: [protectedPath],
        });

        expect(settings.network.allowUnixSockets).toEqual([
          "/var/run/docker.sock",
        ]);
        expect(settings.network).not.toHaveProperty("allowAllUnixSockets");
      } finally {
        await cleanup();
      }
    });

    test("merges nested network and filesystem overrides", async () => {
      const config = `providers:\n  claude:\n    network:\n      allowedDomains:\n        - allowed.example.com\n      allowAllUnixSockets: true\n    filesystem:\n      allowWrite:\n        - /tmp/cache\n      denyRead:\n        - sandbox-secrets\n      denyWrite:\n        - /tmp/cache/sensitive\n`;
      const emitWarning = jest
        .spyOn(process, "emitWarning")
        .mockImplementation(() => {});
      const { root, cleanup } = await setupSandboxConfig(config);

      try {
        const settings = generateSandboxSettings({
          sandboxHomePath,
          workspacePath,
          providerId: "claude",
          root,
          sandboxSettingsPath,
          runtimePath,
          artifactsPath,
          extraWriteProtectedPaths: [protectedPath],
          extraReadProtectedPaths: [protectedPath],
        });

        expect(settings.network.allowedDomains).toEqual([
          "allowed.example.com",
          "api.anthropic.com",
          "console.anthropic.com",
          "mcp-proxy.anthropic.com",
          "platform.claude.com",
        ]);
        expect(settings.network.allowAllUnixSockets).toBe(true);
        expect(new Set(settings.filesystem.allowWrite)).toEqual(
          new Set([sandboxHomePath, workspacePath, "/tmp/cache"]),
        );
        const baseline = expectedRunBaselinePaths(root);
        expect(settings.filesystem.denyRead).toEqual(
          expect.arrayContaining([
            ...baseline,
            join(workspacePath, "sandbox-secrets"),
            artifactsPath,
            protectedPath,
          ]),
        );
        expect(settings.filesystem.denyWrite).toEqual(
          expect.arrayContaining([
            ...baseline,
            "/tmp/cache/sensitive",
            artifactsPath,
            protectedPath,
          ]),
        );
        expect(settings.filesystem.denyWrite).not.toContain(runtimePath);
        expect(emitWarning).toHaveBeenCalledWith(
          expect.stringContaining("allowAllUnixSockets"),
          expect.objectContaining({
            code: "VORATIQ_SANDBOX_ALLOW_ALL_UNIX_SOCKETS",
          }),
        );
      } finally {
        emitWarning.mockRestore();
        await cleanup();
      }
    });

    test("keeps python virtualenv writable", async () => {
      const { root, cleanup } = await setupSandboxConfig("providers: {}\n");

      try {
        const settings = generateSandboxSettings({
          sandboxHomePath,
          workspacePath,
          providerId: "codex",
          root,
          sandboxSettingsPath,
          runtimePath,
          artifactsPath,
          extraWriteProtectedPaths: [protectedPath],
          extraReadProtectedPaths: [protectedPath],
        });

        const baseline = expectedRunBaselinePaths(root);
        expect(settings.filesystem.denyWrite).toEqual(
          expect.arrayContaining([...baseline, artifactsPath, protectedPath]),
        );
        expect(settings.filesystem.denyWrite).not.toContain(runtimePath);
        expect(settings.filesystem.denyWrite).not.toContain(
          join(workspacePath, ".venv"),
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("writeSandboxSettings", () => {
    test("writes settings as formatted JSON", async () => {
      const root = await mkdtemp(join(tmpdir(), "voratiq-sandbox-"));
      const sandboxSettingsPath = join(root, "runtime", "sandbox.json");
      const settings: SandboxSettings = {
        network: {
          allowedDomains: DEFAULT_ALLOWED_DOMAINS,
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [sandboxSettingsPath],
          allowWrite: [join(root, "sandbox", "home"), join(root, "workspace")],
          denyWrite: [sandboxSettingsPath],
        },
      };

      try {
        await writeSandboxSettings(sandboxSettingsPath, settings);
        const written = await readFile(sandboxSettingsPath, "utf8");
        expect(written).toBe(JSON.stringify(settings, null, 2) + "\n");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("resolveSrtBinary", () => {
    test("resolves to node_modules/.bin/srt", () => {
      const cliRoot = "/path/to/cli";
      const srtPath = resolveSrtBinary(cliRoot);
      expect(srtPath).toBe("/path/to/cli/node_modules/.bin/srt");
    });
  });

  describe("checkPlatformSupport", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true,
      });
    });

    test("allows macOS", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true,
      });
      expect(() => checkPlatformSupport()).not.toThrow();
    });

    test("allows Linux", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true,
      });
      expect(() => checkPlatformSupport()).not.toThrow();
    });

    test("rejects Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
        writable: true,
      });
      expect(() => checkPlatformSupport()).toThrow(
        /Sandbox Runtime is not supported on platform/,
      );
    });

    test("rejects other platforms", () => {
      Object.defineProperty(process, "platform", {
        value: "freebsd",
        writable: true,
      });
      expect(() => checkPlatformSupport()).toThrow(
        /Sandbox Runtime is not supported on platform/,
      );
    });
  });
});
