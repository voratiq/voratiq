import { HintedError, toErrorMessage } from "../utils/errors.js";

export class CliError extends HintedError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, { detailLines, hintLines });
    this.name = "CliError";
  }
}

export class NonInteractiveShellError extends CliError {
  constructor() {
    super(
      "Non-interactive shell detected; re-run with --yes to accept defaults.",
    );
    this.name = "NonInteractiveShellError";
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof HintedError) {
    return new CliError(error.headline, error.detailLines, error.hintLines);
  }

  return new CliError(toErrorMessage(error));
}
