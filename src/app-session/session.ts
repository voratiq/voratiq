import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveAppSessionStatePath } from "./state-path.js";

export interface AppSessionPayload {
  version: number;
  installation: {
    id: string;
  };
  session: {
    kind: string;
    id: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
  };
  actor: {
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    flags: string[];
    scopes: string[];
  };
}

interface WriteAppSessionStateDependencies {
  randomBytes: typeof randomBytes;
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
  rm: typeof rm;
  chmod: typeof chmod;
}

export async function writeAppSessionState(
  payload: AppSessionPayload,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<WriteAppSessionStateDependencies> = {},
) {
  const deps: WriteAppSessionStateDependencies = {
    randomBytes,
    mkdir,
    writeFile,
    rename,
    rm,
    chmod,
    ...dependencies,
  };
  const path = resolveAppSessionStatePath(env);
  const dir = dirname(path);
  const tempPath = join(dir, `${deps.randomBytes(8).toString("hex")}.tmp`);

  await deps.mkdir(dir, { recursive: true, mode: 0o700 });

  try {
    await deps.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await deps.rename(tempPath, path);
    await deps.chmod(path, 0o600);
  } catch (error) {
    await deps.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return path;
}
