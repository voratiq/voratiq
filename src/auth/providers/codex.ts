import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { buildAuthFailedMessage } from "./messages.js";
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
  copyOptionalFileWithPermissions,
  createSandboxPaths,
  ensureDirectories,
  isMissing,
  resolveChildPath,
  resolveProviderHome,
} from "./utils.js";

const { F_OK } = fsConstants;

const CODEX_PROVIDER_ID = "codex" as const;
const CODEX_AUTH_FILENAME = "auth.json" as const;
const CODEX_CONFIG_FILENAME = "config.toml" as const;
const CODEX_LOGIN_HINT = buildAuthFailedMessage("Codex");

export const codexAuthProvider: AuthProvider = {
  id: CODEX_PROVIDER_ID,

  async verify(options: VerifyOptions): Promise<VerifyResult> {
    const authPath = await locateCodexAuthFile(options);
    if (!authPath) {
      throw new CodexAuthProviderError(CODEX_LOGIN_HINT);
    }

    await assertReadableFileOrThrow(
      authPath,
      (cause) => new CodexAuthProviderError(CODEX_LOGIN_HINT, { cause }),
    );
    return { status: "ok" };
  },

  async stage(options: StageOptions): Promise<StageResult> {
    const authPath = await locateCodexAuthFile(options);
    if (!authPath) {
      throw new CodexAuthProviderError(CODEX_LOGIN_HINT);
    }

    await assertReadableFileOrThrow(
      authPath,
      (cause) => new CodexAuthProviderError(CODEX_LOGIN_HINT, { cause }),
    );

    const sandboxPaths = createSandboxPaths(options.agentRoot, {
      codex: [".codex"],
      logs: ["Library", "Logs", "Codex"],
      support: ["Library", "Application Support", "Codex"],
    });
    await ensureDirectories(Object.values(sandboxPaths));

    const secretHandles: SecretHandle[] = [];
    try {
      const credentialPath = resolveChildPath(
        sandboxPaths.codex,
        CODEX_AUTH_FILENAME,
      );
      const bytes = await readFile(authPath);
      const handle = await stageSecretFile(sandboxPaths.home, {
        destinationPath: credentialPath,
        sourceBytes: bytes,
        providerId: CODEX_PROVIDER_ID,
        fileLabel: CODEX_AUTH_FILENAME,
      });
      secretHandles.push(handle);

      await copyOptionalConfig(options, sandboxPaths.codex);
    } catch (error) {
      await disposeHandles(secretHandles);
      throw error;
    }

    registerSandboxSecrets(sandboxPaths.home, secretHandles);

    const envResult = composeSandboxEnvResult(sandboxPaths.home, {
      CODEX_HOME: sandboxPaths.codex,
      RUST_BACKTRACE: "1",
    });

    return envResult;
  },

  async teardown(options: TeardownOptions): Promise<void> {
    await teardownAuthProvider(options);
  },
};

class CodexAuthProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodexAuthProviderError";
  }
}

async function locateCodexAuthFile(
  options: VerifyOptions | StageOptions,
): Promise<string | undefined> {
  const codexHome = resolveProviderHome(
    options.runtime,
    "CODEX_HOME",
    ".codex",
  );
  if (!codexHome) {
    return undefined;
  }

  const authPath = resolveChildPath(codexHome, CODEX_AUTH_FILENAME);
  try {
    await access(authPath, F_OK);
    return authPath;
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw new CodexAuthProviderError(CODEX_LOGIN_HINT, { cause: error });
  }
}

async function copyOptionalConfig(
  options: StageOptions,
  sandboxPath: string,
): Promise<void> {
  const codexHome = resolveProviderHome(
    options.runtime,
    "CODEX_HOME",
    ".codex",
  );
  if (!codexHome) {
    return;
  }

  const configPath = resolveChildPath(codexHome, CODEX_CONFIG_FILENAME);
  const destinationConfigPath = resolveChildPath(
    sandboxPath,
    CODEX_CONFIG_FILENAME,
  );
  await copyOptionalFileWithPermissions(
    configPath,
    destinationConfigPath,
    (cause) => new CodexAuthProviderError(CODEX_LOGIN_HINT, { cause }),
  );
}
