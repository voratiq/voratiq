export interface AppendConstraintsOptions {
  extra?: string[];
  readAccess?: string;
  writeAccess?: string;
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
  options: AppendConstraintsOptions = {},
): void {
  const { extra, readAccess, writeAccess } = options;
  const accessLines: string[] = [];

  if (readAccess) {
    accessLines.push(`- Read access: \`${readAccess}\`.`);
  }

  if (writeAccess) {
    accessLines.push(`- Write access: \`${writeAccess}\`.`);
  }

  lines.push(
    "",
    "Constraints:",
    ...accessLines,
    "- You are sandboxed. If an operation is blocked, skip it and continue.",
    "- You are running headlessly. Do not pause for user interaction.",
    ...(extra ?? []),
  );
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
