import { access, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, resolve as resolveAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { isFileSystemError } from "../utils/fs.js";
import { resolvePath } from "../utils/path.js";
import { WorkspaceSetupError } from "./errors.js";

const SHIM_RELATIVE_PATH = [
  "dist",
  "commands",
  "run",
  "shim",
  "run-agent-shim.mjs",
] as const;

function resolveCliInstallRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

export async function ensureWorkspaceShim(options: {
  workspacePath: string;
  cliInstallRoot?: string;
}): Promise<void> {
  const { workspacePath, cliInstallRoot = resolveCliInstallRoot() } = options;

  const sourcePath = resolvePath(cliInstallRoot, ...SHIM_RELATIVE_PATH);
  const targetPath = resolvePath(workspacePath, ...SHIM_RELATIVE_PATH);

  try {
    await access(sourcePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await createOrReplaceSymlink(sourcePath, targetPath);
  } catch (error) {
    if (error instanceof WorkspaceSetupError) {
      throw error;
    }
    if (isFileSystemError(error) && error.code === "ENOENT") {
      throw new WorkspaceSetupError(
        `Voratiq CLI shim missing at ${sourcePath}. Run "npm run build" in the Voratiq CLI checkout before invoking agents.`,
      );
    }
    throw error;
  }
}

async function createOrReplaceSymlink(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  try {
    await symlink(sourcePath, targetPath, "file");
    return;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "EEXIST") {
      const linkTarget = await safeReadlink(targetPath);
      if (linkTarget === sourcePath) {
        return;
      }
      await rm(targetPath, { force: true });
      await symlink(sourcePath, targetPath, "file");
      return;
    }
    throw error;
  }
}

async function safeReadlink(path: string): Promise<string | undefined> {
  try {
    const linkTarget = await readlink(path);
    return resolveAbsolute(dirname(path), linkTarget);
  } catch (error) {
    if (isFileSystemError(error) && error.code === "EINVAL") {
      return undefined;
    }
    throw error;
  }
}
