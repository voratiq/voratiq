import { HintedError, toErrorMessage } from "../utils/errors.js";

const DEFAULT_CLI_ERROR_HINT = "Inspect the error details and retry." as const;

export class CliError extends HintedError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines?: readonly string[],
  ) {
    super(headline, {
      detailLines,
      hintLines:
        hintLines === undefined
          ? [DEFAULT_CLI_ERROR_HINT]
          : Array.from(hintLines),
    });
    this.name = "CliError";
  }
}

export class NonInteractiveShellError extends CliError {
  constructor() {
    super(
      "Interactive confirmation is required.",
      [],
      ["Re-run with `--yes` to accept defaults."],
    );
    this.name = "NonInteractiveShellError";
  }
}

export class RunNotFoundCliError extends CliError {
  constructor(runId: string) {
    super(
      `Run \`${runId}\` not found.`,
      [],
      ["Check available runs with `voratiq list --run`."],
    );
    this.name = "RunNotFoundCliError";
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof HintedError) {
    return new CliError(error.headline, error.detailLines, error.hintLines);
  }

  if (error instanceof AggregateError) {
    const detailLines = error.errors
      .slice(0, 3)
      .map((entry) => toErrorMessage(entry));
    return new CliError("Multiple errors occurred.", detailLines);
  }

  return new CliError(toErrorMessage(error));
}
