import { DisplayableError } from "../utils/errors.js";

export abstract class SessionHistoryError extends DisplayableError {
  constructor(message: string) {
    super(message);
  }
}

export class SessionRecordParseError extends SessionHistoryError {
  constructor(
    public readonly displayPath: string,
    public readonly details: string,
  ) {
    super(`Failed to parse ${displayPath}: ${details}`);
    this.name = "SessionRecordParseError";
  }
}

export class SessionRecordNotFoundError extends SessionHistoryError {
  constructor(public readonly sessionId: string) {
    super(`Session ${sessionId} not found.`);
    this.name = "SessionRecordNotFoundError";
  }
}

export class SessionRecordMutationError extends SessionHistoryError {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "SessionRecordMutationError";
  }
}

export class SessionHistoryLockTimeoutError extends SessionHistoryError {
  constructor(public readonly lockPath: string) {
    super(`Timed out acquiring history lock at ${lockPath}.`);
    this.name = "SessionHistoryLockTimeoutError";
  }
}

export class SessionOptionValidationError extends SessionHistoryError {
  constructor(
    public readonly option: string,
    public readonly detail: string,
  ) {
    super(`Invalid option "${option}": ${detail}`);
  }
}
