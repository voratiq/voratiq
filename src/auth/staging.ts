import { assertPathWithinRoot } from "../utils/path.js";

interface SandboxAssertionOptions {
  sandboxHome: string;
  destinationPath: string;
  providerId: string;
  fileLabel: string;
}

export function assertSandboxDestination(
  options: SandboxAssertionOptions,
): void {
  const { sandboxHome, destinationPath, providerId, fileLabel } = options;
  assertPathWithinRoot(sandboxHome, destinationPath, {
    message: `Secret staging for ${providerId}:${fileLabel} must target the sandbox home (${sandboxHome}). Received ${destinationPath}.`,
  });
}
