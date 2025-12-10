import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

import { claudeAuthProvider } from "../../../src/auth/providers/claude.js";
import { SANDBOX_DIRNAME } from "../../../src/workspace/structure.js";

describe("claudeAuthProvider.stage", () => {
  it("stages sandbox environment variables inside the sandbox home", async () => {
    if (process.platform === "darwin") {
      return;
    }

    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-claude-stage-agent-"),
    );
    const claudeConfigRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-claude-config-"),
    );
    const credentialsPath = join(claudeConfigRoot, ".credentials.json");
    await writeFile(credentialsPath, buildValidCredential(), "utf8");

    let stageResult:
      | Awaited<ReturnType<typeof claudeAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await claudeAuthProvider.stage({
        agentId: "claude",
        agentRoot,
        runtime: {
          platform: process.platform,
          env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigRoot },
          homeDir: os.homedir(),
          username: "voratiq-test",
        },
      });

      const sandboxHome = join(agentRoot, SANDBOX_DIRNAME);
      expect(stageResult.sandboxPath).toBe(sandboxHome);
      expect(stageResult.env.CLAUDE_CONFIG_DIR).toBe(
        join(sandboxHome, ".claude"),
      );
      expect(stageResult.env.HOME).toBe(sandboxHome);
      expect(stageResult.env.XDG_CONFIG_HOME).toBe(
        join(sandboxHome, ".config"),
      );
      expect(stageResult.env.XDG_CACHE_HOME).toBe(join(sandboxHome, ".cache"));
      expect(stageResult.env.XDG_DATA_HOME).toBe(
        join(sandboxHome, ".local", "share"),
      );
      expect(stageResult.env.XDG_STATE_HOME).toBe(
        join(sandboxHome, ".local", "state"),
      );
      expect(stageResult.env.CLAUDE_CODE_DEBUG_LOGS_DIR).toBe(
        join(sandboxHome, "logs", "debug", "claude.log"),
      );
      expect(stageResult.env.TMPDIR).toBe(join(sandboxHome, "tmp"));
      expect(stageResult.env.TEMP).toBe(stageResult.env.TMPDIR);
      expect(stageResult.env.TMP).toBe(stageResult.env.TMPDIR);
      expect(stageResult.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe(
        "true",
      );
      expect(stageResult.env.DISABLE_AUTOUPDATER).toBe("true");
      expect(stageResult.env.DISABLE_ERROR_REPORTING).toBe("true");
      expect(stageResult.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("0");

      await expect(
        access(
          stageResult.env.CLAUDE_CODE_DEBUG_LOGS_DIR,
          fsConstants.W_OK | fsConstants.F_OK,
        ),
      ).resolves.toBeUndefined();
      const debugLogStats = await lstat(
        stageResult.env.CLAUDE_CODE_DEBUG_LOGS_DIR,
      );
      expect(debugLogStats.isFile()).toBe(true);
      await expect(
        access(stageResult.env.XDG_CONFIG_HOME),
      ).resolves.toBeUndefined();
      await expect(access(stageResult.env.TMPDIR)).resolves.toBeUndefined();
      const stagedCredentials = join(
        stageResult.sandboxPath,
        ".claude",
        ".credentials.json",
      );
      await expect(access(stagedCredentials)).resolves.toBeUndefined();
      await expect(
        access(join(stageResult.sandboxPath, ".credentials.json")),
      ).rejects.toThrow();

      const firstRead = await readFile(stagedCredentials, "utf8");
      const secondRead = await readFile(stagedCredentials, "utf8");
      expect(secondRead).toBe(firstRead);

      const credentialStats = await lstat(stagedCredentials);
      expect(credentialStats.isFile()).toBe(true);
      expect(credentialStats.mode & 0o777).toBe(0o600);

      await expect(
        access(join(agentRoot, "workspace", ".claude")),
      ).rejects.toThrow();
    } finally {
      if (stageResult && typeof claudeAuthProvider.teardown === "function") {
        await claudeAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(claudeConfigRoot, { recursive: true, force: true });
    }
  });
});

describe("claudeAuthProvider.stage credential validation", () => {
  it("fails fast when the credential file lacks claudeAiOauth", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-claude-stage-invalid-"),
    );
    const claudeConfigRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-claude-config-invalid-"),
    );
    const credentialsPath = join(claudeConfigRoot, ".credentials.json");
    await writeFile(credentialsPath, '{"primaryApiKey":"sk-test"}', "utf8");

    await expect(
      claudeAuthProvider.stage({
        agentId: "claude",
        agentRoot,
        runtime: {
          platform: "linux",
          env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigRoot },
          homeDir: os.homedir(),
          username: "voratiq-test",
        },
      }),
    ).rejects.toThrow(
      /Claude authentication failed\. Authenticate directly via Claude before continuing\. \(oauth payload missing\)\./i,
    );

    await rm(agentRoot, { recursive: true, force: true });
    await rm(claudeConfigRoot, { recursive: true, force: true });
  });
});

function buildValidCredential(): string {
  return JSON.stringify(
    {
      claudeAiOauth: {
        accessToken: "access-test-token",
        refreshToken: "refresh-test-token",
        expiresAt: Date.now() + 60_000,
      },
      primaryApiKey: "sk-test",
    },
    null,
    2,
  );
}
