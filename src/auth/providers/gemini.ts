import { readFile } from "node:fs/promises";

import { assertSandboxDestination } from "../staging.js";
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
  resolveChildPath,
} from "./utils.js";

const GEMINI_PROVIDER_ID = "gemini" as const;
const GEMINI_LOGIN_HINT = buildAuthFailedMessage("Gemini");
const GEMINI_REQUIRED_FILES = [
  "oauth_creds.json",
  "google_accounts.json",
  "settings.json",
  "state.json",
] as const;
const GEMINI_OPTIONAL_FILES = ["installation_id", "GEMINI.md"] as const;
const GEMINI_API_KEY_ENV_VARS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;

class GeminiAuthProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GeminiAuthProviderError";
  }
}

export const geminiAuthProvider: AuthProvider = {
  id: GEMINI_PROVIDER_ID,

  async verify(options: VerifyOptions): Promise<VerifyResult> {
    const apiKey = resolveGeminiApiKey(options.runtime.env);
    if (apiKey) {
      return { status: "ok" };
    }

    const homeDir = options.runtime.homeDir;
    if (!homeDir) {
      throw new GeminiAuthProviderError(GEMINI_LOGIN_HINT);
    }
    const geminiHome = resolveChildPath(homeDir, ".gemini");

    for (const filename of GEMINI_REQUIRED_FILES) {
      const target = resolveChildPath(geminiHome, filename);
      await assertReadableFileOrThrow(
        target,
        (cause) => new GeminiAuthProviderError(GEMINI_LOGIN_HINT, { cause }),
      );
    }

    const settingsPath = resolveChildPath(geminiHome, "settings.json");
    await validateSettingsFile(settingsPath);

    return { status: "ok" };
  },

  async stage(options: StageOptions): Promise<StageResult> {
    const apiKey = resolveGeminiApiKey(options.runtime.env);
    if (apiKey) {
      return composeSandboxEnvResult(options.agentRoot, {
        GEMINI_API_KEY: apiKey,
        GOOGLE_API_KEY: apiKey,
      });
    }

    const homeDir = options.runtime.homeDir;
    if (!homeDir) {
      throw new GeminiAuthProviderError(GEMINI_LOGIN_HINT);
    }
    const geminiHome = resolveChildPath(homeDir, ".gemini");

    for (const filename of GEMINI_REQUIRED_FILES) {
      const source = resolveChildPath(geminiHome, filename);
      await assertReadableFileOrThrow(
        source,
        (cause) => new GeminiAuthProviderError(GEMINI_LOGIN_HINT, { cause }),
      );
    }

    const sandboxPaths = createSandboxPaths(options.agentRoot, {
      gemini: [".gemini"],
    });
    await ensureDirectories([...Object.values(sandboxPaths)]);

    const secretHandles = await stageRequiredFiles(
      geminiHome,
      sandboxPaths.gemini,
      sandboxPaths.home,
    );
    try {
      await stageOptionalFiles(
        geminiHome,
        sandboxPaths.gemini,
        sandboxPaths.home,
      );
    } catch (error) {
      await disposeHandles(secretHandles);
      throw error;
    }

    registerSandboxSecrets(sandboxPaths.home, secretHandles);

    return composeSandboxEnvResult(sandboxPaths.home, {});
  },

  async teardown(options: TeardownOptions): Promise<void> {
    await teardownAuthProvider(options);
  },
};

function resolveGeminiApiKey(env: NodeJS.ProcessEnv): string | undefined {
  for (const key of GEMINI_API_KEY_ENV_VARS) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

async function stageRequiredFiles(
  geminiHome: string,
  sandboxGeminiDir: string,
  sandboxHome: string,
): Promise<SecretHandle[]> {
  const handles: SecretHandle[] = [];
  try {
    for (const filename of GEMINI_REQUIRED_FILES) {
      const source = resolveChildPath(geminiHome, filename);
      const bytes = await readFile(source);
      if (filename === "settings.json") {
        validateSettingsContent(bytes.toString("utf8"));
      }
      const destination = resolveChildPath(sandboxGeminiDir, filename);
      const handle = await stageSecretFile(sandboxHome, {
        destinationPath: destination,
        sourceBytes: bytes,
        providerId: GEMINI_PROVIDER_ID,
        fileLabel: filename,
      });
      handles.push(handle);
    }
    return handles;
  } catch (error) {
    await disposeHandles(handles);
    throw error;
  }
}

async function stageOptionalFiles(
  geminiHome: string,
  sandboxGeminiDir: string,
  sandboxHome: string,
): Promise<void> {
  for (const filename of GEMINI_OPTIONAL_FILES) {
    const source = resolveChildPath(geminiHome, filename);
    const destination = resolveChildPath(sandboxGeminiDir, filename);
    assertSandboxDestination({
      sandboxHome,
      destinationPath: destination,
      providerId: GEMINI_PROVIDER_ID,
      fileLabel: filename,
    });
    await copyOptionalFileWithPermissions(source, destination, (cause) => {
      return new GeminiAuthProviderError(GEMINI_LOGIN_HINT, { cause });
    });
  }

  // Create empty tmp directory (don't copy contents to avoid polluting
  // chat transcripts with historical sessions from previous runs)
  const sandboxTmpDestination = resolveChildPath(sandboxGeminiDir, "tmp");
  assertSandboxDestination({
    sandboxHome,
    destinationPath: sandboxTmpDestination,
    providerId: GEMINI_PROVIDER_ID,
    fileLabel: "tmp",
  });
  await ensureDirectories([sandboxTmpDestination]);
}

async function validateSettingsFile(settingsPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error) {
    throw new GeminiAuthProviderError(GEMINI_LOGIN_HINT, { cause: error });
  }
  validateSettingsContent(raw);
}

function validateSettingsContent(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new GeminiAuthProviderError(GEMINI_LOGIN_HINT, { cause: error });
  }

  const selectedType = (
    parsed as { security?: { auth?: { selectedType?: unknown } } }
  )?.security?.auth?.selectedType;
  if (typeof selectedType !== "string" || selectedType.trim().length === 0) {
    throw new GeminiAuthProviderError(GEMINI_LOGIN_HINT);
  }
}
