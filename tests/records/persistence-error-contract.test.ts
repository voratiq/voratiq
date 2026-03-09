import {
  mapSessionPersistenceError,
  runPersistenceErrorMapper,
  sessionPersistenceErrorMapper,
} from "../../src/records/persistence-errors.js";
import {
  RunHistoryLockTimeoutError,
  RunOptionValidationError,
  RunRecordMutationError,
  RunRecordNotFoundError,
  RunRecordParseError,
} from "../../src/runs/records/errors.js";
import {
  SessionHistoryLockTimeoutError,
  SessionOptionValidationError,
  SessionRecordMutationError,
  SessionRecordNotFoundError,
  SessionRecordParseError,
} from "../../src/sessions/errors.js";

describe("shared session persistence error mapping", () => {
  it("normalizes filesystem failures into mutation errors for every operator contract", () => {
    const fileSystemError = Object.assign(
      new Error("EACCES: permission denied"),
      {
        code: "EACCES",
      },
    );

    const sessionError = mapSessionPersistenceError(
      fileSystemError,
      sessionPersistenceErrorMapper,
    );
    const runError = mapSessionPersistenceError(
      fileSystemError,
      runPersistenceErrorMapper,
    );

    expect(sessionError).toBeInstanceOf(SessionRecordMutationError);
    expect(sessionError.message).toContain("permission denied");
    expect(runError).toBeInstanceOf(RunRecordMutationError);
    expect(runError.message).toContain("permission denied");
  });

  it("maps shared session parse, missing, and option errors into the run contract", () => {
    const optionError = mapSessionPersistenceError(
      new SessionOptionValidationError("limit", "must be a positive integer"),
      runPersistenceErrorMapper,
    );
    const parseError = mapSessionPersistenceError(
      new SessionRecordParseError("runs/record.json", "invalid json"),
      runPersistenceErrorMapper,
    );
    const notFoundError = mapSessionPersistenceError(
      new SessionRecordNotFoundError("run-123"),
      runPersistenceErrorMapper,
    );

    expect(optionError).toBeInstanceOf(RunOptionValidationError);
    expect(optionError.message).toContain("Invalid option `limit`");
    expect(parseError).toBeInstanceOf(RunRecordParseError);
    expect(parseError.message).toContain("runs/record.json");
    expect(notFoundError).toBeInstanceOf(RunRecordNotFoundError);
    expect(notFoundError.message).toContain("run-123");
  });

  it("normalizes run history lock timeouts back into the shared session contract", () => {
    const mapped = mapSessionPersistenceError(
      new RunHistoryLockTimeoutError("/tmp/history.lock"),
      sessionPersistenceErrorMapper,
    );

    expect(mapped).toBeInstanceOf(SessionHistoryLockTimeoutError);
    expect(mapped).not.toBeInstanceOf(RunHistoryLockTimeoutError);
    expect(mapped.message).toContain("/tmp/history.lock");
  });

  it("preserves the run history lock timeout contract for run persistence", () => {
    const mapped = mapSessionPersistenceError(
      new SessionHistoryLockTimeoutError("/tmp/history.lock"),
      runPersistenceErrorMapper,
    );

    expect(mapped).toBeInstanceOf(RunHistoryLockTimeoutError);
    expect(mapped.message).toContain("/tmp/history.lock");
  });
});
