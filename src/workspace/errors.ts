import { HintedError } from "../utils/errors.js";

const DEFAULT_WORKSPACE_HINT = [
  "Run `voratiq doctor --fix` to repair workspace setup.",
] as const satisfies readonly string[];

export class WorkspaceError extends HintedError {
  constructor(
    message: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = DEFAULT_WORKSPACE_HINT,
  ) {
    super(message, { detailLines, hintLines });
    this.name = "WorkspaceError";
  }
}

export class WorkspaceMissingEntryError extends WorkspaceError {
  constructor(public readonly entryPath: string) {
    super(`Missing workspace entry: \`${entryPath}\`.`);
    this.name = "WorkspaceMissingEntryError";
  }
}

export class WorkspaceWrongTypeEntryError extends WorkspaceError {
  constructor(
    public readonly entryPath: string,
    public readonly expectedType: "file" | "directory",
  ) {
    super(
      `Wrong workspace entry type: \`${entryPath}\` must be a ${expectedType}.`,
    );
    this.name = "WorkspaceWrongTypeEntryError";
  }
}

export class WorkspaceNotInitializedError extends WorkspaceError {
  constructor(public readonly missingEntries: readonly string[]) {
    super(
      "Voratiq workspace is not initialized.",
      buildMissingEntryDetailLines(missingEntries),
      ["Run `voratiq doctor --fix` to repair workspace setup."],
    );
    this.name = "WorkspaceNotInitializedError";
  }
}

export class WorkspaceSetupError extends WorkspaceError {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "WorkspaceSetupError";
  }
}

function buildMissingEntryDetailLines(
  entries: readonly string[],
): readonly string[] {
  if (entries.length === 0) {
    return [];
  }

  return [
    "Missing workspace entries:",
    ...entries.map((entry) => `  - \`${entry}\``),
  ];
}
