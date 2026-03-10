import { RunHistoryLockTimeoutError } from "../domains/runs/model/errors.js";
import { toErrorMessage } from "../utils/errors.js";
import { isFileSystemError } from "../utils/fs.js";
import {
  SessionHistoryLockTimeoutError,
  SessionOptionValidationError,
  SessionRecordMutationError,
  SessionRecordNotFoundError,
  SessionRecordParseError,
} from "./errors.js";

type FileSystemError = NodeJS.ErrnoException & { code: string };

type HistoryLockTimeoutError =
  | RunHistoryLockTimeoutError
  | SessionHistoryLockTimeoutError;

export interface SessionStoreErrorMapper {
  readonly optionValidation: (error: SessionOptionValidationError) => Error;
  readonly recordParse: (error: SessionRecordParseError) => Error;
  readonly recordNotFound: (error: SessionRecordNotFoundError) => Error;
  readonly recordMutation: (error: SessionRecordMutationError) => Error;
  readonly historyLockTimeout: (error: HistoryLockTimeoutError) => Error;
  readonly fileSystem: (error: FileSystemError) => Error;
  readonly error: (error: Error) => Error;
  readonly unknown: (error: unknown) => Error;
}

export function mapSessionStoreError(
  error: unknown,
  mapper: SessionStoreErrorMapper,
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

export const sessionStoreErrorMapper: SessionStoreErrorMapper = {
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
