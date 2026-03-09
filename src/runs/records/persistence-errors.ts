import { type SessionPersistenceErrorMapper } from "../../sessions/persistence-errors.js";
import { toErrorMessage } from "../../utils/errors.js";
import {
  RunHistoryLockTimeoutError,
  RunOptionValidationError,
  RunRecordMutationError,
  RunRecordNotFoundError,
  RunRecordParseError,
} from "./errors.js";

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
