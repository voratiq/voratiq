import { readFile } from "node:fs/promises";

import {
  CLAUDE_CONFIG_DIRNAME,
  CLAUDE_CREDENTIAL_FILENAME,
  CLAUDE_LOGIN_HINT,
  CLAUDE_PROVIDER_ID,
} from "./claude/constants.js";
import {
  locateClaudeApiKey,
  locateClaudeCredentials,
  validateClaudeCredentialSecret,
} from "./claude/credentials.js";
import { ClaudeAuthProviderError } from "./claude/error.js";
import {
  ensureKeychainCredential,
  readKeychainCredential,
} from "./claude/keychain.js";
import {
  disposeHandles,
  registerSandboxSecrets,
  type SecretHandle,
  stageSecretFile,
} from "./secret-staging.js";
import { teardownAuthProvider } from "./teardown.js";
import type {
  AuthProvider,
  StageOptions,
  StageResult,
  TeardownOptions,
  VerifyOptions,
  VerifyResult,
} from "./types.js";
import {
  assertReadableFileOrThrow,
  composeSandboxEnvResult,
  createSandboxPaths,
  ensureDirectories,
  resolveChildPath,
  writeFileWithPermissions,
} from "./utils.js";

export const claudeAuthProvider: AuthProvider = {
  id: CLAUDE_PROVIDER_ID,

  async verify(options: VerifyOptions): Promise<VerifyResult> {
    if (isMac(options.runtime.platform)) {
      await ensureKeychainCredential(options.runtime);
      return { status: "ok" };
    }

    const credentialsPath = await locateClaudeCredentials(options);
    if (credentialsPath) {
      return { status: "ok" };
    }

    const apiKey = await locateClaudeApiKey(options);
    if (!apiKey) {
      throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT);
    }

    return { status: "ok" };
  },

  async stage(options: StageOptions): Promise<StageResult> {
    return stageClaudeCredentials(options);
  },

  async teardown(options: TeardownOptions): Promise<void> {
    await teardownAuthProvider(options);
  },
};

async function stageClaudeCredentials(
  options: StageOptions,
): Promise<StageResult> {
  const sandboxPaths = createSandboxPaths(options.agentRoot, {
    config: [".config"],
    cache: [".cache"],
    data: [".local", "share"],
    state: [".local", "state"],
    logs: ["logs"],
    debugLogs: ["logs", "debug"],
    tmp: ["tmp"],
  });
  const claudeConfigDir = resolveChildPath(
    sandboxPaths.home,
    CLAUDE_CONFIG_DIRNAME,
  );
  const debugLogFile = resolveChildPath(sandboxPaths.debugLogs, "claude.log");
  const sandboxCredentialPath = resolveChildPath(
    claudeConfigDir,
    CLAUDE_CREDENTIAL_FILENAME,
  );
  let stagedApiKey: string | undefined;

  await ensureDirectories([...Object.values(sandboxPaths), claudeConfigDir]);
  await writeFileWithPermissions(debugLogFile, "", { flag: "a" });

  const secretHandles: SecretHandle[] = [];
  const stageCredential = async (payload: string): Promise<void> => {
    validateClaudeCredentialSecret(payload);
    const handle = await stageSecretFile(sandboxPaths.home, {
      destinationPath: sandboxCredentialPath,
      sourceBytes: Buffer.from(payload, "utf8"),
      providerId: CLAUDE_PROVIDER_ID,
      fileLabel: CLAUDE_CREDENTIAL_FILENAME,
    });
    secretHandles.push(handle);
  };

  try {
    if (isMac(options.runtime.platform)) {
      const secret = await readKeychainCredential(options.runtime);
      if (!secret) {
        throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT);
      }
      await stageCredential(secret);
    } else {
      const credentialsPath = await locateClaudeCredentials(options);
      if (credentialsPath) {
        await assertReadableFileOrThrow(
          credentialsPath,
          (cause) => new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause }),
        );
        const credentialsContent = await readFile(credentialsPath, "utf8");
        await stageCredential(credentialsContent);
      } else {
        const apiKey = await locateClaudeApiKey(options);
        if (!apiKey) {
          throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT);
        }
        stagedApiKey = apiKey;
        const apiKeyConfigPath = resolveChildPath(
          options.runtime.homeDir,
          ".claude.json",
        );
        await assertReadableFileOrThrow(
          apiKeyConfigPath,
          (cause) => new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause }),
        );
        const apiKeyConfigContent = await readFile(apiKeyConfigPath, "utf8");
        const handle = await stageSecretFile(sandboxPaths.home, {
          destinationPath: resolveChildPath(sandboxPaths.home, ".claude.json"),
          sourceBytes: Buffer.from(apiKeyConfigContent, "utf8"),
          providerId: CLAUDE_PROVIDER_ID,
          fileLabel: ".claude.json",
        });
        secretHandles.push(handle);
      }
    }
  } catch (error) {
    await disposeHandles(secretHandles);
    throw error;
  }

  registerSandboxSecrets(sandboxPaths.home, secretHandles);

  const stagedEnv = buildSandboxEnvironment(
    sandboxPaths,
    claudeConfigDir,
    debugLogFile,
  );
  if (stagedApiKey) {
    stagedEnv.ANTHROPIC_API_KEY = stagedApiKey;
  }
  return composeSandboxEnvResult(sandboxPaths.home, stagedEnv);
}

function buildSandboxEnvironment(
  paths: Record<string, string>,
  claudeConfigDir: string,
  debugLogFile: string,
): Record<string, string> {
  return {
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    XDG_CONFIG_HOME: paths.config,
    XDG_CACHE_HOME: paths.cache,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    CLAUDE_CODE_DEBUG_LOGS_DIR: debugLogFile,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "true",
    DISABLE_AUTOUPDATER: "true",
    DISABLE_ERROR_REPORTING: "true",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0",
    TMPDIR: paths.tmp,
    TEMP: paths.tmp,
    TMP: paths.tmp,
  };
}

function isMac(platform: NodeJS.Platform): boolean {
  return platform === "darwin";
}
