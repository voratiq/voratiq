import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { safeUnlink } from "../../utils/fs.js";
import { assertSandboxDestination } from "../staging.js";
import { writeFileWithPermissions } from "./utils.js";

const SECRET_FILE_MODE = 0o600;

export interface SecretHandle {
  abort(): void;
  cleanup(): Promise<void>;
}

export interface StageSecretFileOptions {
  destinationPath: string;
  sourceBytes: Buffer;
  providerId: string;
  fileLabel: string;
}

const sandboxSecretRegistry = new Map<string, SecretHandle[]>();

export async function stageSecretFile(
  sandboxPath: string,
  options: StageSecretFileOptions,
): Promise<SecretHandle> {
  assertSandboxDestination({
    sandboxHome: sandboxPath,
    destinationPath: options.destinationPath,
    providerId: options.providerId,
    fileLabel: options.fileLabel,
  });

  await mkdir(dirname(options.destinationPath), { recursive: true });

  try {
    await writeFileWithPermissions(
      options.destinationPath,
      options.sourceBytes,
      { mode: SECRET_FILE_MODE, flag: "w" },
      SECRET_FILE_MODE,
    );
  } catch (error) {
    throw new Error(
      `Failed to stage secret file for ${options.providerId}:${options.fileLabel} at ${options.destinationPath}.`,
      { cause: error },
    );
  }

  return new SecretFileHandle(options.destinationPath);
}

export function registerSandboxSecrets(
  sandboxPath: string,
  handles: SecretHandle[],
): void {
  if (handles.length === 0) {
    return;
  }
  sandboxSecretRegistry.set(sandboxPath, handles);
}

export async function cleanupSandbox(sandboxPath: string): Promise<void> {
  const handles = sandboxSecretRegistry.get(sandboxPath);
  if (!handles) {
    return;
  }
  sandboxSecretRegistry.delete(sandboxPath);
  await disposeHandles(handles);
}

export async function disposeHandles(
  handles: readonly SecretHandle[],
): Promise<void> {
  const uniqueHandles = [...new Set(handles)];
  const errors: unknown[] = [];

  for (const handle of uniqueHandles) {
    try {
      handle.abort();
    } catch (error) {
      errors.push(error);
    }
  }

  for (const handle of uniqueHandles) {
    try {
      await handle.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }
}

class SecretFileHandle implements SecretHandle {
  constructor(private readonly path: string) {}

  abort(): void {
    // No-op for regular files
  }

  async cleanup(): Promise<void> {
    await safeUnlink(this.path);
  }
}
