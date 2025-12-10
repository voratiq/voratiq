import {
  isAbsolute,
  join,
  relative,
  resolve as resolveAbsolute,
} from "node:path";

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:/.test(value);
}

export function isRepoRelativePath(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (value.trim() !== value) {
    return false;
  }
  if (value.length === 0) {
    return false;
  }
  if (value === ".") {
    return true;
  }
  if (value.startsWith("/")) {
    return false;
  }
  if (isWindowsAbsolutePath(value)) {
    return false;
  }
  if (value.includes("\\")) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function assertRepoRelativePath(
  value: string,
  message = `Path "${value}" must be repo-relative, use forward slashes, and omit '.' or '..' segments.`,
): string {
  if (!isRepoRelativePath(value)) {
    throw new Error(message);
  }
  return value;
}

export function resolvePath(root: string, ...segments: string[]): string {
  return join(root, ...segments);
}

export interface PathWithinRootOptions {
  message?: string;
}

function normalizeRoot(root: string): string {
  return resolveAbsolute(root);
}

function isWithinRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  if (relativePath === "" || relativePath === ".") {
    return true;
  }
  if (relativePath.startsWith("..")) {
    return false;
  }
  if (isAbsolute(relativePath)) {
    return false;
  }
  return true;
}

export function assertPathWithinRoot(
  root: string,
  targetPath: string,
  options?: PathWithinRootOptions,
): string {
  const normalizedRoot = normalizeRoot(root);
  const normalizedTarget = isAbsolute(targetPath)
    ? resolveAbsolute(targetPath)
    : resolveAbsolute(normalizedRoot, targetPath);
  if (!isWithinRoot(normalizedRoot, normalizedTarget)) {
    throw new Error(
      options?.message ??
        `Path "${normalizedTarget}" escapes root "${normalizedRoot}".`,
    );
  }
  return normalizedTarget;
}

export function resolvePathWithinRoot(
  root: string,
  segments: readonly string[],
  options?: PathWithinRootOptions,
): string {
  const resolved = resolveAbsolute(root, ...segments);
  return assertPathWithinRoot(root, resolved, options);
}

export function relativeToRoot(root: string, target: string): string {
  return relative(root, target) || ".";
}

export function normalizePathForDisplay(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.replace(/\/+$/u, "");
}

export function resolveDisplayPath(
  root: string,
  displayPath: string | null | undefined,
): string | null {
  if (!displayPath) {
    return null;
  }
  return isAbsolute(displayPath)
    ? displayPath
    : resolveAbsolute(root, displayPath);
}
