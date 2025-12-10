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

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof HintedError) {
    return new CliError(error.headline, error.detailLines, error.hintLines);
  }

  return new CliError(toErrorMessage(error));
}
