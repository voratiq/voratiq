import { HintedError } from "../utils/errors.js";

const DEFAULT_WORKSPACE_HINT = [
  "Run `voratiq init` to configure the workspace.",
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
    super(`Missing workspace entry: ${entryPath}`);
    this.name = "WorkspaceMissingEntryError";
  }
}

export class WorkspaceNotInitializedError extends WorkspaceError {
  constructor(public readonly missingEntries: readonly string[]) {
    super(
      "Voratiq workspace not found; aborting run.",
      buildMissingEntryDetailLines(missingEntries),
      ["Run `voratiq init` from the repository root and rerun."],
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
    ...entries.map((entry) => `  - ${entry}`),
  ];
}
