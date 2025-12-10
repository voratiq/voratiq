import { rm } from "node:fs/promises";

/**
 * Remove a run workspace directory, ignoring cleanup errors to preserve the original failure context.
 */
export async function cleanupRunWorkspace(runRoot: string): Promise<void> {
  try {
    await rm(runRoot, { recursive: true, force: true });
  } catch {
    // Intentionally ignore cleanup failures.
  }
}
