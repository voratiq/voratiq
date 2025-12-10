import { cleanupSandbox } from "./secret-staging.js";
import type { TeardownOptions } from "./types.js";
import { teardownSandbox } from "./utils.js";

export async function teardownAuthProvider(
  options: TeardownOptions,
): Promise<void> {
  await cleanupSandbox(options.sandboxPath);
  await teardownSandbox(options);
}
