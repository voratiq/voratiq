import { existsSync } from "node:fs";
import { dirname, resolve as resolveNative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_JSON_FILENAME = "package.json" as const;
const CLI_ROOT_ERROR_MESSAGE =
  "Unable to locate Voratiq CLI root directory. Ensure the Voratiq binary is running from its install directory." as const;

let cachedCliRoot: string | undefined;

export function resolveCliAssetRoot(): string {
  if (cachedCliRoot) {
    return cachedCliRoot;
  }

  const helperDirectory = fileURLToPath(new URL(".", import.meta.url));
  const derivedRoot = ascendToPackageRoot(helperDirectory);
  if (derivedRoot) {
    cachedCliRoot = derivedRoot;
    return cachedCliRoot;
  }

  throw buildResolutionError(
    `Attempted discovery starting from "${helperDirectory}".`,
  );
}

export function getCliAssetPath(...segments: string[]): string {
  const root = resolveCliAssetRoot();
  return resolveNative(root, ...segments);
}

function ascendToPackageRoot(start: string): string | undefined {
  let current = start;

  while (true) {
    if (isValidCliRoot(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function isValidCliRoot(candidate: string): boolean {
  const packagePath = resolveNative(candidate, PACKAGE_JSON_FILENAME);
  return existsSync(packagePath);
}

function buildResolutionError(detail: string): Error {
  return new Error(`${CLI_ROOT_ERROR_MESSAGE} ${detail}`);
}
