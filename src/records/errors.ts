import { DisplayableError } from "../utils/errors.js";

export abstract class RunHistoryError extends DisplayableError {
  constructor(message: string) {
    super(message);
  }
}

export class RunRecordParseError extends RunHistoryError {
  constructor(
    public readonly displayPath: string,
    public readonly details: string,
  ) {
    super(`Failed to parse ${displayPath}: ${details}`);
    this.name = "RunRecordParseError";
  }
}

export class RunRecordNotFoundError extends RunHistoryError {
  constructor(public readonly runId: string) {
    super(`Run ${runId} not found.`);
    this.name = "RunRecordNotFoundError";
  }
}

export class RunRecordMutationError extends RunHistoryError {
  constructor(detail: string) {
    super(detail);
    this.name = "RunRecordMutationError";
  }
}

export class RunHistoryLockTimeoutError extends RunHistoryError {
  constructor(public readonly lockPath: string) {
    super(`Timed out acquiring history lock at ${lockPath}.`);
    this.name = "RunHistoryLockTimeoutError";
  }
}

export class RunOptionValidationError extends RunHistoryError {
  constructor(option: string, detail: string) {
    super(`Invalid option "${option}": ${detail}`);
  }
}
