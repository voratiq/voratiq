import { homedir, userInfo } from "node:os";

import type { AuthRuntimeContext } from "./providers/types.js";

function resolveHomeDir(): string {
  const envHome = process.env.HOME;
  if (envHome && envHome.trim().length > 0) {
    return envHome;
  }
  return homedir();
}

export function buildAuthRuntimeContext(): AuthRuntimeContext {
  const { username } = userInfo();
  return {
    platform: process.platform,
    env: process.env,
    homeDir: resolveHomeDir(),
    username,
  };
}
