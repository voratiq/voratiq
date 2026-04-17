import {
  getOperatorAccessProfile,
  type SandboxStageId,
} from "../../agents/runtime/operator-access.js";

export interface AppendConstraintsOptions {
  extra?: string[];
  stageId: SandboxStageId;
  repoRootPath?: string;
  workspacePath: string;
  supplementalReadAccess?: readonly string[];
  readOnlyWritePaths?: readonly string[];
}

export interface WorkspaceArtifactRequirement {
  instruction: string;
  path: string;
  schema?: {
    content: string | readonly string[];
    leadIn: string;
  };
}

export function appendConstraints(
  lines: string[],
  options: AppendConstraintsOptions,
): void {
  const { extra } = options;
  const accessLines = [
    `- Read access: ${buildReadAccessDescription(options)}.`,
    `- Write access: ${buildWriteAccessDescription(options)}.`,
  ];

  lines.push(
    "",
    "Constraints:",
    ...accessLines,
    "- You are sandboxed. If an operation is blocked, skip it and continue.",
    "- You are running headlessly. Do not pause for user interaction.",
    ...(extra ?? []),
  );
}

function buildReadAccessDescription(options: AppendConstraintsOptions): string {
  const profile = getOperatorAccessProfile(options.stageId);
  const basePath =
    profile.readRoot === "repo-root"
      ? resolveRepoRootPath(options)
      : options.workspacePath;
  const paths = dedupeStrings([
    basePath,
    ...(options.supplementalReadAccess ?? []),
  ]);
  return formatAccessPaths(paths);
}

function buildWriteAccessDescription(
  options: AppendConstraintsOptions,
): string {
  const profile = getOperatorAccessProfile(options.stageId);
  const basePath =
    profile.writeRoot === "workspace-root"
      ? options.workspacePath
      : options.workspacePath;
  const readonlyPaths = dedupeStrings(options.readOnlyWritePaths ?? []);
  const base = formatAccessPaths([basePath]);
  if (readonlyPaths.length === 0) {
    return base;
  }
  return `${base} except read-only staged paths ${formatAccessPaths(
    readonlyPaths,
  )}`;
}

function resolveRepoRootPath(options: AppendConstraintsOptions): string {
  if (options.repoRootPath) {
    return options.repoRootPath;
  }
  throw new Error(
    `Operator \`${options.stageId}\` requires \`repoRootPath\` to describe read access.`,
  );
}

function formatAccessPaths(paths: readonly string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}

function dedupeStrings(entries: readonly string[]): string[] {
  return Array.from(new Set(entries));
}

export function appendOutputRequirements(
  lines: string[],
  extra?: string[],
): void {
  lines.push(
    "",
    "Output requirements:",
    ...(extra ?? []),
    "- Do not write files outside the workspace.",
  );
}

export function buildWorkspaceArtifactRequirements(
  requirements: readonly WorkspaceArtifactRequirement[],
  extra: readonly string[] = [],
): string[] {
  const lines = requirements.flatMap((requirement) => {
    const instructionLine = `- ${requirement.instruction} to \`${requirement.path}\` in the workspace root${
      requirement.schema ? `, ${requirement.schema.leadIn}:` : "."
    }`;

    if (!requirement.schema) {
      return [instructionLine];
    }

    const schemaLines = Array.isArray(requirement.schema.content)
      ? requirement.schema.content
      : [requirement.schema.content];

    return [instructionLine, ...schemaLines.map((line) => `  ${line}`)];
  });

  return [...lines, ...extra];
}
