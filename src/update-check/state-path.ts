import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_FILENAME = "update-state.json";
const APP_DIR = "voratiq";

/**
 * Resolve the path to the update-check cache file.
 *
 * macOS/Linux:
 *   $XDG_STATE_HOME/voratiq/update-state.json   (when XDG_STATE_HOME is set)
 *   ~/.local/state/voratiq/update-state.json     (fallback)
 */
export function resolveUpdateStatePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdgState = env.XDG_STATE_HOME;
  const base =
    xdgState && xdgState.length > 0
      ? xdgState
      : join(homedir(), ".local", "state");

  return join(base, APP_DIR, CACHE_FILENAME);
}
