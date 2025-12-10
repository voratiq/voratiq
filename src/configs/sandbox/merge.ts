import type { SandboxProviderNetworkDefaults } from "./defaults.js";
import type {
  FilesystemOverride,
  NetworkOverride,
  ProviderOverride,
} from "./schemas.js";
import type { SandboxFilesystemConfig, SandboxNetworkConfig } from "./types.js";

export function mergeNetworkConfig(
  base: SandboxProviderNetworkDefaults | SandboxNetworkConfig,
  override?: NetworkOverride,
): SandboxNetworkConfig {
  const allowed = mergeUniqueStrings(
    base.allowedDomains,
    override?.allowedDomains ?? [],
  );
  const denied = mergeUniqueStrings(
    base.deniedDomains,
    override?.deniedDomains ?? [],
  );
  const allowLocalBinding =
    typeof override?.allowLocalBinding === "boolean"
      ? override.allowLocalBinding
      : Boolean((base as SandboxNetworkConfig).allowLocalBinding);
  const allowUnixSockets = mergeUniqueStrings(
    getAllowUnixSockets(base),
    override?.allowUnixSockets ?? [],
  );
  const allowAllUnixSockets =
    override?.allowAllUnixSockets ?? getAllowAllUnixSockets(base);

  return {
    allowedDomains: allowed,
    deniedDomains: denied,
    allowLocalBinding,
    ...(allowUnixSockets.length > 0 ? { allowUnixSockets } : {}),
    ...(allowAllUnixSockets ? { allowAllUnixSockets } : {}),
  } satisfies SandboxNetworkConfig;
}

export function mergeFilesystemConfig(
  base: SandboxFilesystemConfig,
  override?: FilesystemOverride,
): SandboxFilesystemConfig {
  const allowWrite = mergeOptionalStrings(
    base.allowWrite,
    override?.allowWrite,
  );
  const denyRead = mergeOptionalStrings(base.denyRead, override?.denyRead);
  const denyWrite = mergeOptionalStrings(base.denyWrite, override?.denyWrite);
  return {
    allowWrite: allowWrite ?? [...base.allowWrite],
    denyRead: denyRead ?? [...base.denyRead],
    denyWrite: denyWrite ?? [...base.denyWrite],
  };
}

export function extractNetworkOverride(
  override?: ProviderOverride,
): NetworkOverride | undefined {
  if (!override) {
    return undefined;
  }
  return override.network ?? pickNetworkOverrideFromTopLevel(override);
}

export function extractFilesystemOverride(
  override?: ProviderOverride,
): FilesystemOverride | undefined {
  return override?.filesystem;
}

export function pickNetworkOverrideFromTopLevel(
  override: ProviderOverride,
): NetworkOverride | undefined {
  const {
    allowedDomains,
    deniedDomains,
    allowLocalBinding,
    allowUnixSockets,
    allowAllUnixSockets,
  } = override;

  if (
    !allowedDomains &&
    !deniedDomains &&
    typeof allowLocalBinding === "undefined" &&
    !allowUnixSockets &&
    typeof allowAllUnixSockets === "undefined"
  ) {
    return undefined;
  }

  return {
    ...(allowedDomains ? { allowedDomains } : {}),
    ...(deniedDomains ? { deniedDomains } : {}),
    ...(typeof allowLocalBinding === "boolean" ? { allowLocalBinding } : {}),
    ...(allowUnixSockets ? { allowUnixSockets } : {}),
    ...(typeof allowAllUnixSockets === "boolean"
      ? { allowAllUnixSockets }
      : {}),
  };
}

function mergeOptionalStrings(
  first?: readonly string[],
  second?: readonly string[],
): string[] | undefined {
  if (!first && !second) {
    return undefined;
  }

  return mergeUniqueStrings(first ?? [], second ?? []);
}

export function mergeUniqueStrings(
  base: readonly string[],
  extras: readonly string[],
): string[] {
  const seen = new Set<string>();
  const combined: string[] = [];

  for (const value of base) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    combined.push(value);
  }

  for (const value of extras) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    combined.push(value);
  }

  return combined;
}

function getAllowUnixSockets(
  config: SandboxProviderNetworkDefaults | SandboxNetworkConfig,
): readonly string[] {
  if (
    Object.prototype.hasOwnProperty.call(config, "allowUnixSockets") &&
    Array.isArray((config as SandboxNetworkConfig).allowUnixSockets)
  ) {
    const values = (config as SandboxNetworkConfig).allowUnixSockets;
    return values ?? [];
  }
  return [];
}

function getAllowAllUnixSockets(
  config: SandboxProviderNetworkDefaults | SandboxNetworkConfig,
): boolean {
  if (
    Object.prototype.hasOwnProperty.call(config, "allowAllUnixSockets") &&
    typeof (config as SandboxNetworkConfig).allowAllUnixSockets === "boolean"
  ) {
    return (config as SandboxNetworkConfig).allowAllUnixSockets ?? false;
  }
  return false;
}
