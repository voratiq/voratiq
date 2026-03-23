import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  finalizeActiveVerification,
  registerActiveVerification,
  terminateActiveVerification,
  VERIFY_ABORT_DETAIL,
} from "../../../src/commands/verify/lifecycle.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import { writeVerificationArtifact } from "../../../src/domains/verifications/competition/artifacts.js";
import type { VerificationRecord } from "../../../src/domains/verifications/model/types.js";
import {
  flushVerificationRecordBuffer,
  readVerificationRecords,
  rewriteVerificationRecord,
} from "../../../src/domains/verifications/persistence/adapter.js";
import { pathExists } from "../../../src/utils/fs.js";

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
  const tempRoots: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    flushVerificationRecordBufferMock.mockResolvedValue(undefined);
    writeVerificationArtifactMock.mockResolvedValue(undefined);
    teardownSessionAuthMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearActiveVerification(VERIFICATION_ID);
    return Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    ).then(() => undefined);
  });

  it("marks running methods as aborted, persists fallback artifacts, and finalizes the verification record", async () => {
    const teardown = createTeardownController(`verify \`${VERIFICATION_ID}\``);
    teardown.addAction({
      key: `verify-auth:${VERIFICATION_ID}`,
      label: "session auth",
      cleanup: async () => {
        await teardownSessionAuth(VERIFICATION_ID);
      },
    });
    registerActiveVerification({
      root: "/repo",
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      verificationId: VERIFICATION_ID,
      teardown,
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

  it("prunes verify scratch state while retaining artifacts on finalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-finalize-"));
    tempRoots.push(root);

    const agentRoot = join(
      root,
      ".voratiq",
      "verifications",
      "sessions",
      VERIFICATION_ID,
      "verifier",
      "run-review",
    );
    const workspacePath = join(agentRoot, "workspace");
    const artifactsPath = join(agentRoot, "artifacts");
    const contextPath = join(agentRoot, "context");
    const runtimePath = join(agentRoot, "runtime");
    const sandboxPath = join(agentRoot, "sandbox");
    const sharedRoot = join(root, ".shared");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await mkdir(contextPath, { recursive: true });
    await mkdir(runtimePath, { recursive: true });
    await mkdir(sandboxPath, { recursive: true });
    await mkdir(sharedRoot, { recursive: true });

    const teardown = createTeardownController(`verify \`${VERIFICATION_ID}\``);
    teardown.addPath(workspacePath, "verifier workspace");
    teardown.addPath(contextPath, "verifier context");
    teardown.addPath(runtimePath, "verifier runtime");
    teardown.addPath(sandboxPath, "verifier sandbox");
    teardown.addPath(sharedRoot, "shared verification inputs");

    registerActiveVerification({
      root,
      verificationsFilePath: join(
        root,
        ".voratiq",
        "verifications",
        "index.json",
      ),
      verificationId: VERIFICATION_ID,
      teardown,
    });

    await finalizeActiveVerification(VERIFICATION_ID);

    await expect(pathExists(workspacePath)).resolves.toBe(false);
    await expect(pathExists(contextPath)).resolves.toBe(false);
    await expect(pathExists(runtimePath)).resolves.toBe(false);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
    await expect(pathExists(sharedRoot)).resolves.toBe(false);
    await expect(pathExists(artifactsPath)).resolves.toBe(true);
  });

  it("reports teardown diagnostics without failing verification finalization", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const teardown = createTeardownController(`verify \`${VERIFICATION_ID}\``);
    teardown.addAction({
      key: "broken-cleanup",
      label: "broken cleanup",
      cleanup: () => Promise.reject(new Error("boom")),
    });

    registerActiveVerification({
      root: "/repo",
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      verificationId: VERIFICATION_ID,
      teardown,
    });

    await expect(
      finalizeActiveVerification(VERIFICATION_ID),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to teardown verify `verify-123`"),
    );

    warnSpy.mockRestore();
  });
});
