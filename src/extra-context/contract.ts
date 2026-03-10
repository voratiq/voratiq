const EXTRA_CONTEXT_STAGED_PREFIX_SEGMENTS = ["..", "context"] as const;

export const EXTRA_CONTEXT_STAGED_PREFIX = `${EXTRA_CONTEXT_STAGED_PREFIX_SEGMENTS.join("/")}/`;

export interface PersistableExtraContextFile {
  readonly displayPath: string;
  readonly stagedRelativePath: string;
}

export interface PersistedExtraContextMetadataEntry {
  readonly stagedPath: string;
  readonly sourcePath: string;
}

export interface PersistedExtraContextFields {
  readonly extraContext?: string[];
  readonly extraContextMetadata?: PersistedExtraContextMetadataEntry[];
}

export function buildPersistedExtraContextFields(
  files: readonly PersistableExtraContextFile[],
): PersistedExtraContextFields {
  if (files.length === 0) {
    return {};
  }

  return {
    extraContext: files.map((file) =>
      assertExtraContextStagedPath(file.stagedRelativePath),
    ),
    extraContextMetadata: files.map((file) => ({
      stagedPath: assertExtraContextStagedPath(file.stagedRelativePath),
      sourcePath: assertExtraContextSourcePath(file.displayPath),
    })),
  };
}

export function assertExtraContextStagedPath(
  value: string,
  message = `Path "${value}" must be session-relative under "../context/" with forward slashes.`,
): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  if (value.trim() !== value || value.length === 0) {
    throw new Error(message);
  }
  if (value.startsWith("/")) {
    throw new Error(message);
  }
  if (isWindowsAbsolutePath(value)) {
    throw new Error(message);
  }
  if (value.includes("\\")) {
    throw new Error(message);
  }

  const segments = value.split("/");
  if (segments.length < 3) {
    throw new Error(message);
  }

  const [parentSegment, contextSegment, ...rest] = segments;
  if (
    parentSegment !== EXTRA_CONTEXT_STAGED_PREFIX_SEGMENTS[0] ||
    contextSegment !== EXTRA_CONTEXT_STAGED_PREFIX_SEGMENTS[1]
  ) {
    throw new Error(message);
  }

  if (
    rest.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(message);
  }

  return value;
}

export function assertExtraContextSourcePath(
  value: string,
  message = `Path "${value}" must be a non-empty normalized source path.`,
): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  if (value.trim() !== value || value.length === 0) {
    throw new Error(message);
  }

  return value;
}

export function toExtraContextContextSubpath(stagedPath: string): string {
  assertExtraContextStagedPath(stagedPath);
  return stagedPath.slice(EXTRA_CONTEXT_STAGED_PREFIX.length);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:/.test(value);
}
