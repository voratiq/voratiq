import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { teardownSessionAuth } from "../../../src/agents/runtime/registry.js";
import {
  clearActiveVerification,
  registerActiveVerification,
  terminateActiveVerification,
  VERIFY_ABORT_DETAIL,
} from "../../../src/commands/verify/lifecycle.js";
import { writeVerificationArtifact } from "../../../src/domains/verifications/competition/artifacts.js";
import type { VerificationRecord } from "../../../src/domains/verifications/model/types.js";
import {
  flushVerificationRecordBuffer,
  readVerificationRecords,
  rewriteVerificationRecord,
} from "../../../src/domains/verifications/persistence/adapter.js";

jest.mock("../../../src/domains/verifications/persistence/adapter.js", () => ({
  readVerificationRecords: jest.fn(),
  rewriteVerificationRecord: jest.fn(),
  flushVerificationRecordBuffer: jest.fn(),
}));

jest.mock(
  "../../../src/domains/verifications/competition/artifacts.js",
  () => ({
    writeVerificationArtifact: jest.fn(),
  }),
);

jest.mock("../../../src/agents/runtime/registry.js", () => ({
  teardownSessionAuth: jest.fn(),
}));

const readVerificationRecordsMock = jest.mocked(readVerificationRecords);
const rewriteVerificationRecordMock = jest.mocked(rewriteVerificationRecord);
const flushVerificationRecordBufferMock = jest.mocked(
  flushVerificationRecordBuffer,
);
const writeVerificationArtifactMock = jest.mocked(writeVerificationArtifact);
const teardownSessionAuthMock = jest.mocked(teardownSessionAuth);

describe("verify lifecycle", () => {
  const VERIFICATION_ID = "verify-123";

  beforeEach(() => {
    jest.clearAllMocks();
    flushVerificationRecordBufferMock.mockResolvedValue(undefined);
    writeVerificationArtifactMock.mockResolvedValue(undefined);
    teardownSessionAuthMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearActiveVerification(VERIFICATION_ID);
  });

  it("marks running methods as aborted, persists fallback artifacts, and finalizes the verification record", async () => {
    registerActiveVerification({
      root: "/repo",
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      verificationId: VERIFICATION_ID,
    });

    const existingRecord: VerificationRecord = {
      sessionId: VERIFICATION_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:05.000Z",
      status: "running",
      target: {
        kind: "run",
        sessionId: "run-123",
        candidateIds: ["agent-a", "agent-b"],
      },
      methods: [
        {
          method: "programmatic",
          slug: "programmatic",
          scope: { kind: "run" },
          status: "running",
          startedAt: "2026-01-01T00:00:06.000Z",
        },
        {
          method: "rubric",
          template: "run-review",
          verifierId: "verifier-a",
          scope: { kind: "run" },
          status: "running",
          startedAt: "2026-01-01T00:00:07.000Z",
        },
        {
          method: "rubric",
          template: "run-review",
          verifierId: "verifier-b",
          scope: { kind: "run" },
          status: "succeeded",
          artifactPath:
            ".voratiq/verifications/sessions/verify-123/verifier-b/run-review/artifacts/result.json",
          startedAt: "2026-01-01T00:00:07.000Z",
          completedAt: "2026-01-01T00:00:30.000Z",
          error: null,
        },
      ],
      blinded: {
        enabled: true,
        aliasMap: { r_aaaaaaaaaa: "agent-a" },
      },
    };

    readVerificationRecordsMock.mockResolvedValue([existingRecord]);

    let mutatedRecord: VerificationRecord | undefined;
    rewriteVerificationRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveVerification("aborted");

    expect(readVerificationRecordsMock).toHaveBeenCalledTimes(1);
    expect(writeVerificationArtifactMock).toHaveBeenCalledTimes(2);
    expect(rewriteVerificationRecordMock).toHaveBeenCalledTimes(1);
    expect(flushVerificationRecordBufferMock).toHaveBeenCalledWith({
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      sessionId: VERIFICATION_ID,
    });
    expect(teardownSessionAuthMock).toHaveBeenCalledWith(VERIFICATION_ID);

    expect(mutatedRecord?.status).toBe("aborted");
    expect(mutatedRecord?.error).toBe(VERIFY_ABORT_DETAIL);
    expect(mutatedRecord?.completedAt).toEqual(expect.any(String));
    expect(mutatedRecord?.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "programmatic",
          status: "aborted",
          artifactPath:
            ".voratiq/verifications/sessions/verify-123/programmatic/artifacts/result.json",
          error: VERIFY_ABORT_DETAIL,
          completedAt: expect.any(String),
        }),
        expect.objectContaining({
          method: "rubric",
          verifierId: "verifier-a",
          status: "aborted",
          artifactPath:
            ".voratiq/verifications/sessions/verify-123/verifier-a/run-review/artifacts/result.json",
          error: VERIFY_ABORT_DETAIL,
          completedAt: expect.any(String),
        }),
        expect.objectContaining({
          method: "rubric",
          verifierId: "verifier-b",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("is a no-op when no active verification is registered", async () => {
    await terminateActiveVerification("failed");

    expect(readVerificationRecordsMock).not.toHaveBeenCalled();
    expect(writeVerificationArtifactMock).not.toHaveBeenCalled();
    expect(rewriteVerificationRecordMock).not.toHaveBeenCalled();
    expect(flushVerificationRecordBufferMock).not.toHaveBeenCalled();
    expect(teardownSessionAuthMock).not.toHaveBeenCalled();
  });
});
