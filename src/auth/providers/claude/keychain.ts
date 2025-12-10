import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { resolve as resolvePathNative } from "node:path";
import { promisify } from "node:util";

import type { AuthRuntimeContext } from "../types.js";
import { isMissing, resolveChildPath } from "../utils.js";
import {
  CLAUDE_LOGIN_HINT,
  CLAUDE_SERVICE_NAME,
  MAC_LOGIN_KEYCHAIN_HINT,
} from "./constants.js";
import { ClaudeAuthProviderError } from "./error.js";

const execFileAsync = promisify(execFile);

const LOGIN_KEYCHAIN_FILENAMES = [
  "login.keychain-db",
  "login.keychain",
] as const;
type LoginKeychainFilename = (typeof LOGIN_KEYCHAIN_FILENAMES)[number];

const TEST_KEYCHAIN_SECRET_PATH_ENV = "VORATIQ_TEST_KEYCHAIN_SECRET_PATH";

export async function ensureKeychainCredential(
  runtime: AuthRuntimeContext,
): Promise<void> {
  await readKeychainCredential(runtime);
}

export async function readKeychainCredential(
  runtime: AuthRuntimeContext,
): Promise<string> {
  const testSecretPath = getTestKeychainSecretPath();
  if (testSecretPath) {
    return readTestSecret(testSecretPath);
  }

  await assertLoginKeychainExists(runtime.homeDir);
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      CLAUDE_SERVICE_NAME,
      "-a",
      runtime.username,
      "-w",
    ]);
    return stdout;
  } catch (error) {
    if (isMissingKeychainError(error)) {
      throw new ClaudeAuthProviderError(MAC_LOGIN_KEYCHAIN_HINT, {
        cause: error,
      });
    }
    throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause: error });
  }
}

export async function assertLoginKeychainExists(
  homeDir: string,
): Promise<void> {
  const testSecretPath = getTestKeychainSecretPath();
  if (testSecretPath) {
    await ensureTestSecretAvailable(testSecretPath);
    return;
  }

  try {
    const hasKeychain = await hasLoginKeychain(homeDir);
    if (!hasKeychain) {
      throw new ClaudeAuthProviderError(MAC_LOGIN_KEYCHAIN_HINT);
    }
  } catch (error) {
    if (error instanceof ClaudeAuthProviderError) {
      throw error;
    }
    throw new ClaudeAuthProviderError(MAC_LOGIN_KEYCHAIN_HINT, {
      cause: error,
    });
  }
}

async function hasLoginKeychain(homeDir: string): Promise<boolean> {
  if (!homeDir) {
    return false;
  }

  const keychainsRoot = resolveChildPath(homeDir, "Library", "Keychains");
  let entries: Dirent[];
  try {
    entries = await readdir(keychainsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }

  for (const entry of entries) {
    if (
      isLoginKeychainName(entry.name) &&
      (entry.isFile() || entry.isSymbolicLink())
    ) {
      return true;
    }
    if (entry.isDirectory()) {
      const directoryPath = resolvePathNative(keychainsRoot, entry.name);
      const hasKeychainFile =
        await directoryContainsLoginKeychain(directoryPath);
      if (hasKeychainFile) {
        return true;
      }
    }
  }

  return false;
}

async function directoryContainsLoginKeychain(
  directory: string,
): Promise<boolean> {
  for (const filename of LOGIN_KEYCHAIN_FILENAMES) {
    const candidatePath = resolvePathNative(directory, filename);
    try {
      await access(candidatePath);
      return true;
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
  return false;
}

function isLoginKeychainName(name: string): boolean {
  return LOGIN_KEYCHAIN_FILENAMES.includes(name as LoginKeychainFilename);
}

function isMissingKeychainError(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  ) {
    const stderr = (error as { stderr: string }).stderr;
    if (/errSecNoSuchKeychain/i.test(stderr)) {
      return true;
    }
    if (/SecKeychainCopyDefault:.*could not be found/i.test(stderr)) {
      return true;
    }
    if (/The specified keychain could not be found/i.test(stderr)) {
      return true;
    }
  }

  if (error instanceof Error && error.message) {
    if (/errSecNoSuchKeychain/i.test(error.message)) {
      return true;
    }
    if (/The specified keychain could not be found/i.test(error.message)) {
      return true;
    }
  }

  return false;
}

function getTestKeychainSecretPath(): string | undefined {
  const override = process.env[TEST_KEYCHAIN_SECRET_PATH_ENV];
  if (override && override.trim().length > 0) {
    return override;
  }
  return undefined;
}

async function ensureTestSecretAvailable(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    throw new ClaudeAuthProviderError(MAC_LOGIN_KEYCHAIN_HINT, {
      cause: error,
    });
  }
}

async function readTestSecret(path: string): Promise<string> {
  await ensureTestSecretAvailable(path);
  return readFile(path, "utf8");
}
