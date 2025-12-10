export class GitRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitRepositoryError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface HintedErrorOptions {
  readonly detailLines?: readonly string[];
  readonly hintLines?: readonly string[];
  readonly cause?: unknown;
}

export class HintedError extends Error {
  public readonly headline: string;
  public readonly detailLines: readonly string[];
  public readonly hintLines: readonly string[];

  constructor(headline: string, options: HintedErrorOptions = {}) {
    const { cause, detailLines, hintLines } = options;
    super(headline, cause !== undefined ? { cause } : undefined);
    this.headline = headline;
    this.detailLines = detailLines ? Array.from(detailLines) : [];
    this.hintLines = hintLines ? Array.from(hintLines) : [];
  }
}

/**
 * Base class for errors that include a messageForDisplay() method.
 * Reduces boilerplate for errors that return their stored message unchanged.
 */
export abstract class DisplayableError extends HintedError {
  protected readonly displayMessage: string;

  constructor(message: string, options: HintedErrorOptions = {}) {
    super(message, options);
    this.displayMessage = message;
  }

  public messageForDisplay(): string {
    return this.displayMessage;
  }
}

export class GitHeadRequiredError extends HintedError {
  constructor() {
    super("Repository has no commits yet.", {
      hintLines: ["Create an initial commit and re-run."],
    });
    this.name = "GitHeadRequiredError";
  }
}

export function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(toErrorMessage(error));
}
