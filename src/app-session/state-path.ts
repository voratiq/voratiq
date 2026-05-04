import { homedir } from "node:os";
import { join } from "node:path";

import { VORATIQ_DIR } from "../workspace/constants.js";

const APP_SESSION_FILENAME = "app-session.json";
const REPOSITORIES_FILENAME = "repositories.json";

export function resolveAppSessionStatePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const home = env.HOME?.trim();
  const base = home && home.length > 0 ? home : homedir();
  return join(base, VORATIQ_DIR, APP_SESSION_FILENAME);
}

export function resolveRepositoryRegistryStatePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const home = env.HOME?.trim();
  const base = home && home.length > 0 ? home : homedir();
  return join(base, VORATIQ_DIR, REPOSITORIES_FILENAME);
}
