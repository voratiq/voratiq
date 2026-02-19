import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

import { codexAuthProvider } from "../../../src/auth/providers/codex.js";
import { SANDBOX_DIRNAME } from "../../../src/workspace/structure.js";

describe("codexAuthProvider.stage", () => {
  it("stages sandbox home and env variables for Codex", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-codex-stage-agent-"),
    );
    const codexHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-codex-auth-home-"),
    );
    await writeFile(
      join(codexHome, "auth.json"),
      JSON.stringify({ access_token: "test" }),
      "utf8",
    );
    await writeFile(join(codexHome, "config.toml"), "setting = true\n", "utf8");

    let stageResult:
      | Awaited<ReturnType<typeof codexAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await codexAuthProvider.stage({
        agentId: "codex",
        agentRoot,
        includeConfigToml: true,
        runtime: {
          platform: process.platform,
          env: { ...process.env, CODEX_HOME: codexHome },
          homeDir: os.homedir(),
          username: "voratiq-test",
        },
      });

      const sandboxHome = join(agentRoot, SANDBOX_DIRNAME);
      const sandboxCodex = join(sandboxHome, ".codex");
      const sandboxLogs = join(sandboxHome, "Library", "Logs", "Codex");
      const sandboxSupport = join(
        sandboxHome,
        "Library",
        "Application Support",
        "Codex",
      );
      expect(stageResult.sandboxPath).toBe(sandboxHome);
      expect(stageResult.env.CODEX_HOME).toBe(sandboxCodex);
      expect(stageResult.env.HOME).toBe(sandboxHome);
      expect(stageResult.env.TMPDIR).toBe(join(sandboxHome, "tmp"));
      expect(stageResult.env.TEMP).toBe(stageResult.env.TMPDIR);
      expect(stageResult.env.TMP).toBe(stageResult.env.TMPDIR);

      await expect(access(sandboxCodex)).resolves.toBeUndefined();
      const stagedAuthPath = join(sandboxCodex, "auth.json");
      const stagedConfigPath = join(sandboxCodex, "config.toml");
      await expect(access(stagedAuthPath)).resolves.toBeUndefined();
      await expect(access(stagedConfigPath)).resolves.toBeUndefined();
      await expect(access(sandboxLogs)).resolves.toBeUndefined();
      await expect(access(sandboxSupport)).resolves.toBeUndefined();

      const firstRead = await readFile(stagedAuthPath, "utf8");
      const secondRead = await readFile(stagedAuthPath, "utf8");
      expect(secondRead).toBe(firstRead);

      const stagedAuthStats = await lstat(stagedAuthPath);
      const stagedConfigStats = await stat(stagedConfigPath);
      expect(stagedAuthStats.isFile()).toBe(true);
      expect(stagedAuthStats.mode & 0o777).toBe(0o600);
      expect(stagedConfigStats.mode & 0o777).toBe(0o600);

      await expect(
        access(join(agentRoot, "workspace", ".codex")),
      ).rejects.toThrow();
    } finally {
      if (stageResult && typeof codexAuthProvider.teardown === "function") {
        await codexAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});

describe("codexAuthProvider optional config", () => {
  it("skips copying config.toml when absent", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-codex-stage-optional-"),
    );
    const codexHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-codex-auth-optional-"),
    );
    await writeFile(
      join(codexHome, "auth.json"),
      JSON.stringify({ access_token: "test" }),
      "utf8",
    );

    let stageResult:
      | Awaited<ReturnType<typeof codexAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await codexAuthProvider.stage({
        agentId: "codex",
        agentRoot,
        includeConfigToml: true,
        runtime: {
          platform: process.platform,
          env: { ...process.env, CODEX_HOME: codexHome },
          homeDir: os.homedir(),
          username: "voratiq-test",
        },
      });

      const sandboxCodex = join(stageResult.sandboxPath, ".codex");
      await expect(access(join(sandboxCodex, "config.toml"))).rejects.toThrow();
    } finally {
      if (stageResult && typeof codexAuthProvider.teardown === "function") {
        await codexAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});

describe("codexAuthProvider optional config policy", () => {
  it("does not copy config.toml when includeConfigToml is false", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-codex-stage-policy-"),
    );
    const codexHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-codex-auth-policy-"),
    );
    await writeFile(
      join(codexHome, "auth.json"),
      JSON.stringify({ access_token: "test" }),
      "utf8",
    );
    await writeFile(join(codexHome, "config.toml"), "setting = true\n", "utf8");

    let stageResult:
      | Awaited<ReturnType<typeof codexAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await codexAuthProvider.stage({
        agentId: "codex",
        agentRoot,
        includeConfigToml: false,
        runtime: {
          platform: process.platform,
          env: { ...process.env, CODEX_HOME: codexHome },
          homeDir: os.homedir(),
          username: "voratiq-test",
        },
      });

      const sandboxCodex = join(stageResult.sandboxPath, ".codex");
      await expect(
        access(join(sandboxCodex, "auth.json")),
      ).resolves.toBeUndefined();
      await expect(access(join(sandboxCodex, "config.toml"))).rejects.toThrow();
    } finally {
      if (stageResult && typeof codexAuthProvider.teardown === "function") {
        await codexAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});
