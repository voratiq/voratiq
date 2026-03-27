import {
  RunHistoryLockTimeoutError,
  RunOptionValidationError,
  RunRecordMutationError,
  RunRecordNotFoundError,
  RunRecordParseError,
} from "../../src/domain/run/model/errors.js";
import { runStoreErrorMapper } from "../../src/domain/run/persistence/error-mapping.js";
import {
  mapSessionStoreError,
  sessionStoreErrorMapper,
} from "../../src/persistence/error-mapping.js";
import {
  SessionHistoryLockTimeoutError,
  SessionOptionValidationError,
  SessionRecordMutationError,
  SessionRecordNotFoundError,
  SessionRecordParseError,
} from "../../src/persistence/errors.js";

describe("shared session persistence error mapping", () => {
  it("normalizes filesystem failures into mutation errors for every operator contract", () => {
    const fileSystemError = Object.assign(
      new Error("EACCES: permission denied"),
      {
        code: "EACCES",
      },
    );

    const sessionError = mapSessionStoreError(
      fileSystemError,
      sessionStoreErrorMapper,
    );
    const runError = mapSessionStoreError(fileSystemError, runStoreErrorMapper);

    expect(sessionError).toBeInstanceOf(SessionRecordMutationError);
    expect(sessionError.message).toContain("permission denied");
    expect(runError).toBeInstanceOf(RunRecordMutationError);
    expect(runError.message).toContain("permission denied");
  });

  it("maps shared session parse, missing, and option errors into the run contract", () => {
    const optionError = mapSessionStoreError(
      new SessionOptionValidationError("limit", "must be a positive integer"),
      runStoreErrorMapper,
    );
    const parseError = mapSessionStoreError(
      new SessionRecordParseError("runs/record.json", "invalid json"),
      runStoreErrorMapper,
    );
    const notFoundError = mapSessionStoreError(
      new SessionRecordNotFoundError("run-123"),
      runStoreErrorMapper,
    );

    expect(optionError).toBeInstanceOf(RunOptionValidationError);
    expect(optionError.message).toContain("Invalid option `limit`");
    expect(parseError).toBeInstanceOf(RunRecordParseError);
    expect(parseError.message).toContain("runs/record.json");
    expect(notFoundError).toBeInstanceOf(RunRecordNotFoundError);
    expect(notFoundError.message).toContain("run-123");
  });

  it("normalizes run history lock timeouts back into the shared session contract", () => {
    const mapped = mapSessionStoreError(
      new RunHistoryLockTimeoutError("/tmp/history.lock"),
      sessionStoreErrorMapper,
    );

    expect(mapped).toBeInstanceOf(SessionHistoryLockTimeoutError);
    expect(mapped).not.toBeInstanceOf(RunHistoryLockTimeoutError);
    expect(mapped.message).toContain("/tmp/history.lock");
  });

  it("preserves the run history lock timeout contract for run persistence", () => {
    const mapped = mapSessionStoreError(
      new SessionHistoryLockTimeoutError("/tmp/history.lock"),
      runStoreErrorMapper,
    );

    expect(mapped).toBeInstanceOf(RunHistoryLockTimeoutError);
    expect(mapped.message).toContain("/tmp/history.lock");
  });
});
