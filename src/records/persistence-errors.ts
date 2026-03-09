import {
  RunHistoryLockTimeoutError,
  RunOptionValidationError,
  RunRecordMutationError,
  RunRecordNotFoundError,
  RunRecordParseError,
} from "../runs/records/errors.js";
import {
  SessionHistoryLockTimeoutError,
  SessionOptionValidationError,
  SessionRecordMutationError,
  SessionRecordNotFoundError,
  SessionRecordParseError,
} from "../sessions/errors.js";
import { toErrorMessage } from "../utils/errors.js";
import { isFileSystemError } from "../utils/fs.js";

type FileSystemError = NodeJS.ErrnoException & { code: string };

type HistoryLockTimeoutError =
  | RunHistoryLockTimeoutError
  | SessionHistoryLockTimeoutError;

export interface SessionPersistenceErrorMapper {
  readonly optionValidation: (error: SessionOptionValidationError) => Error;
  readonly recordParse: (error: SessionRecordParseError) => Error;
  readonly recordNotFound: (error: SessionRecordNotFoundError) => Error;
  readonly recordMutation: (error: SessionRecordMutationError) => Error;
  readonly historyLockTimeout: (error: HistoryLockTimeoutError) => Error;
  readonly fileSystem: (error: FileSystemError) => Error;
  readonly error: (error: Error) => Error;
  readonly unknown: (error: unknown) => Error;
}

export function mapSessionPersistenceError(
  error: unknown,
  mapper: SessionPersistenceErrorMapper,
): Error {
  if (error instanceof SessionOptionValidationError) {
    return mapper.optionValidation(error);
  }
  if (error instanceof SessionRecordParseError) {
    return mapper.recordParse(error);
  }
  if (error instanceof SessionRecordNotFoundError) {
    return mapper.recordNotFound(error);
  }
  if (error instanceof SessionRecordMutationError) {
    return mapper.recordMutation(error);
  }
  if (
    error instanceof SessionHistoryLockTimeoutError ||
    error instanceof RunHistoryLockTimeoutError
  ) {
    return mapper.historyLockTimeout(error);
  }
  if (isFileSystemError(error)) {
    return mapper.fileSystem(error);
  }
  if (error instanceof Error) {
    return mapper.error(error);
  }
  return mapper.unknown(error);
}

export const sessionPersistenceErrorMapper: SessionPersistenceErrorMapper = {
  optionValidation: (error) => error,
  recordParse: (error) => error,
  recordNotFound: (error) => error,
  recordMutation: (error) => error,
  historyLockTimeout: (error) => {
    if (error instanceof SessionHistoryLockTimeoutError) {
      return error;
    }
    return new SessionHistoryLockTimeoutError(error.lockPath);
  },
  fileSystem: (error) => new SessionRecordMutationError(toErrorMessage(error)),
  error: (error) => error,
  unknown: (error) => new Error(toErrorMessage(error)),
};

export const runPersistenceErrorMapper: SessionPersistenceErrorMapper = {
  optionValidation: (error) =>
    new RunOptionValidationError(error.option, error.detail),
  recordParse: (error) =>
    new RunRecordParseError(error.displayPath, error.details),
  recordNotFound: (error) => new RunRecordNotFoundError(error.sessionId),
  recordMutation: (error) => new RunRecordMutationError(error.detail),
  historyLockTimeout: (error) => {
    if (error instanceof RunHistoryLockTimeoutError) {
      return error;
    }
    return new RunHistoryLockTimeoutError(error.lockPath);
  },
  fileSystem: (error) => new RunRecordMutationError(toErrorMessage(error)),
  error: (error) => error,
  unknown: (error) => new Error(toErrorMessage(error)),
};
