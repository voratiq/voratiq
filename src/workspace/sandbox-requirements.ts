import { execSync } from "node:child_process";

export type SandboxPlatform = "macos" | "linux" | "unsupported";

export interface SandboxDependency {
  binary: string;
  displayName: string;
}

const MAC_DEPENDENCIES: SandboxDependency[] = [
  { binary: "rg", displayName: "ripgrep (rg)" },
];

const LINUX_DEPENDENCIES: SandboxDependency[] = [
  { binary: "rg", displayName: "ripgrep (rg)" },
  { binary: "bwrap", displayName: "bubblewrap (bwrap)" },
  { binary: "socat", displayName: "socat" },
];

export interface DependencyCheckOptions {
  platform?: NodeJS.Platform;
  commandExists?: (binary: string) => boolean;
  canBindLocalhost?: () => boolean;
}

export function detectSandboxPlatform(
  platform: NodeJS.Platform = process.platform,
): SandboxPlatform {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "linux") {
    return "linux";
  }
  return "unsupported";
}

export function listSandboxDependencies(
  options: {
    platform?: NodeJS.Platform;
  } = {},
): SandboxDependency[] {
  const platform = detectSandboxPlatform(options.platform);
  if (platform === "macos") {
    return MAC_DEPENDENCIES;
  }
  if (platform === "linux") {
    return LINUX_DEPENDENCIES;
  }
  return [];
}

export function collectMissingSandboxDependencies(
  options: DependencyCheckOptions = {},
): SandboxDependency[] {
  const { platform, commandExists = commandExistsInPath } = options;
  const dependencies = listSandboxDependencies({ platform });
  return dependencies.filter((dependency) => !commandExists(dependency.binary));
}

export function hasSandboxDependencies(
  options: DependencyCheckOptions = {},
): boolean {
  const {
    platform,
    commandExists,
    canBindLocalhost = canBindLocalhostDefault,
  } = options;
  const resolvedPlatform = detectSandboxPlatform(platform);
  if (resolvedPlatform === "unsupported") {
    return false;
  }
  const missing = collectMissingSandboxDependencies({
    platform,
    commandExists,
  });
  if (missing.length > 0) {
    return false;
  }
  return canBindLocalhost();
}

export function formatSandboxDependencyList(
  dependencies: readonly SandboxDependency[],
): string {
  return dependencies.map((dependency) => dependency.displayName).join(", ");
}

function commandExistsInPath(binary: string): boolean {
  try {
    execSync(`command -v ${binary}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function canBindLocalhostDefault(): boolean {
  try {
    execSync(
      `node -e "require('net').createServer().listen(0,'127.0.0.1').close()"`,
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}
