import { CliError } from "../cli/errors.js";

export class SpecNotFoundError extends CliError {
  constructor(specPath: string) {
    super(`Spec file not found: ${specPath}`);
    this.name = "SpecNotFoundError";
  }
}

export class DirtyWorkingTreeError extends CliError {
  constructor(detailLines: readonly string[], hintLines: readonly string[]) {
    super(
      "Repository has uncommitted tracked changes.",
      detailLines,
      hintLines,
    );
    this.name = "DirtyWorkingTreeError";
  }
}

export class SandboxDependenciesError extends CliError {
  constructor(missing: string) {
    super(
      "Missing sandbox dependencies.",
      [`Missing: ${missing}`],
      [
        "Install the missing dependencies and re-run the command. For more information, see: https://github.com/anthropic-experimental/sandbox-runtime/blob/1bafa66a2c3ebc52569fc0c1a868e85e778f66a0/README.md#platform-specific-dependencies",
      ],
    );
    this.name = "SandboxDependenciesError";
  }
}
