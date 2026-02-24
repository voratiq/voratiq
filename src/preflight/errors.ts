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
      [`Missing dependencies: ${missing}.`],
      ["Install the missing dependencies, then retry."],
    );
    this.name = "SandboxDependenciesError";
  }
}

export class BranchCheckoutError extends CliError {
  constructor(message: string, gitError?: string) {
    const detailLines = gitError ? [gitError] : [];
    super(message, detailLines, [
      "Resolve the branch checkout issue, then retry.",
    ]);
    this.name = "BranchCheckoutError";
  }
}
