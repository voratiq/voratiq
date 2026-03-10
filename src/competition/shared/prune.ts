import { rm } from "node:fs/promises";

export async function pruneWorkspace(workspacePath: string): Promise<void> {
  await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
}
