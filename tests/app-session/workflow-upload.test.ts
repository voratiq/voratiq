import { describe, expect, it, jest } from "@jest/globals";

import { AppApiError } from "../../src/app-session/api-client.js";
import {
  type AppWorkflowSessionUploadPayload,
  buildAppWorkflowSessionUploadPayload,
  createAppWorkflowUploadWarningBuffer,
  drainPendingAppWorkflowSessionUploads,
  queueAppWorkflowSessionUpload,
  registerAppWorkflowSessionUploadHandler,
  uploadAppWorkflowSessionBestEffort,
} from "../../src/app-session/workflow-upload.js";
import { emitPersistedWorkflowRecordEvent } from "../../src/domain/shared/workflow-record-events.js";
import { signedInAppSessionState } from "../support/factories/app-session.js";
import {
  buildLinkedRepositoryState,
  buildMessageWorkflowPersistedRecord,
  buildReductionWorkflowPersistedRecord,
  buildRepositoryEnsureRequestForUpload,
  buildRepositoryEnsureResponseForUpload,
  buildRunWorkflowPersistedRecord,
  buildSpecWorkflowPersistedRecord,
  buildVerificationWorkflowPersistedRecord,
  buildWorkflowSessionResponse,
  type WorkflowSessionResponseFixture,
} from "../support/factories/app-workflow-upload.js";

const readSignedInAppSessionState = () =>
  Promise.resolve(signedInAppSessionState());

describe("app workflow upload payloads", () => {
  it("preserves the exact snake_case API shape", () => {
    const payload = buildAppWorkflowSessionUploadPayload({
      ...buildRunWorkflowPersistedRecord(),
      localRepoKey: "repo-local-key",
    });

    expect(payload).toEqual({
      local_repo_key: "repo-local-key",
      operator: "run",
      session_id: "run-123",
      status: "succeeded",
      created_at: "2026-04-24T12:34:56.000Z",
      started_at: "2026-04-24T12:35:01.000Z",
      completed_at: "2026-04-24T12:39:00.000Z",
      record_updated_at: "2026-04-24T12:39:01.000Z",
      raw_record: buildRunWorkflowPersistedRecord().record,
      target: {
        kind: "spec",
        session_id: "spec-123",
      },
    });
    expect(Object.keys(payload).sort()).toEqual([
      "completed_at",
      "created_at",
      "local_repo_key",
      "operator",
      "raw_record",
      "record_updated_at",
      "session_id",
      "started_at",
      "status",
      "target",
    ]);
  });

  it("maps a real local run record fixture", () => {
    const payload = buildAppWorkflowSessionUploadPayload({
      ...buildRunWorkflowPersistedRecord(),
      localRepoKey: "repo-local-key",
    });

    expect(payload.session_id).toBe("run-123");
    expect(payload.operator).toBe("run");
    expect(payload.raw_record).toEqual(
      buildRunWorkflowPersistedRecord().record,
    );
    expect(payload.target).toEqual({
      kind: "spec",
      session_id: "spec-123",
    });
  });

  it("maps supported operator targets and nullable timestamps", () => {
    const specPayload = buildAppWorkflowSessionUploadPayload({
      ...buildSpecWorkflowPersistedRecord(),
      localRepoKey: "repo-local-key",
    });

    expect(specPayload).toMatchObject({
      raw_record: buildSpecWorkflowPersistedRecord().record,
    });
    expect(specPayload).not.toHaveProperty("target");

    expect(
      buildAppWorkflowSessionUploadPayload({
        ...buildMessageWorkflowPersistedRecord(),
        localRepoKey: "repo-local-key",
      }),
    ).toMatchObject({
      target: {
        kind: "interactive",
        session_id: "interactive-123",
      },
    });

    expect(
      buildAppWorkflowSessionUploadPayload({
        ...buildReductionWorkflowPersistedRecord(),
        localRepoKey: "repo-local-key",
      }),
    ).toMatchObject({
      target: {
        kind: "message",
        session_id: "message-123",
      },
    });

    expect(
      buildAppWorkflowSessionUploadPayload({
        ...buildVerificationWorkflowPersistedRecord(),
        localRepoKey: "repo-local-key",
      }),
    ).toMatchObject({
      target: {
        kind: "run",
        session_id: "run-123",
      },
    });
  });
});

describe("app workflow upload warning buffering", () => {
  it("buffers default warnings until the active sink closes", async () => {
    const warningBuffer = createAppWorkflowUploadWarningBuffer();
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const outcome = await warningBuffer.run(() =>
        uploadAppWorkflowSessionBestEffort(buildRunWorkflowPersistedRecord(), {
          createAppWorkflowSession: () =>
            Promise.reject(
              new AppApiError("Unauthorized", "unauthorized", 401),
            ),
          resolveRepositoryLink: () =>
            Promise.resolve({
              kind: "linked",
              localRepoKey: "repo-local-key",
            }),
          warningCache: new Set<string>(),
        }),
      );

      expect(outcome).toEqual({
        kind: "warning",
        reason: "login_required",
        message: "[voratiq] App workflow upload skipped. Run `voratiq login`.",
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(warningBuffer.closeAndDrain()).toEqual([
        "[voratiq] App workflow upload skipped. Run `voratiq login`.",
      ]);

      await uploadAppWorkflowSessionBestEffort(
        buildRunWorkflowPersistedRecord(),
        {
          createAppWorkflowSession: () =>
            Promise.reject(
              new AppApiError("Unauthorized", "unauthorized", 401),
            ),
          resolveRepositoryLink: () =>
            Promise.resolve({
              kind: "linked",
              localRepoKey: "repo-local-key",
            }),
          warningCache: new Set<string>(),
        },
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[voratiq] App workflow upload skipped. Run `voratiq login`.",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});

describe("app workflow upload queue draining", () => {
  it("waits for queued uploads to finish", async () => {
    let resolveUpload:
      | ((value: WorkflowSessionResponseFixture) => void)
      | undefined;
    const createAppWorkflowSessionMock = jest.fn(
      () =>
        new Promise<WorkflowSessionResponseFixture>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    queueAppWorkflowSessionUpload(buildRunWorkflowPersistedRecord(), {
      createAppWorkflowSession: createAppWorkflowSessionMock as never,
      resolveRepositoryLink: () =>
        Promise.resolve({
          kind: "linked",
          localRepoKey: "repo-local-key",
        }),
      warningCache: new Set<string>(),
    });

    await settleAsync();
    await settleAsync();
    expect(createAppWorkflowSessionMock).toHaveBeenCalledTimes(1);

    const drainPromise = drainPendingAppWorkflowSessionUploads({
      timeoutMs: 1_000,
    });
    resolveUpload?.(buildWorkflowSessionResponse());

    await expect(drainPromise).resolves.toEqual({
      kind: "drained",
      startedPendingCount: 1,
      remainingPendingCount: 0,
    });
  });

  it("returns a timeout without throwing when queued uploads do not finish", async () => {
    let resolveUpload:
      | ((value: WorkflowSessionResponseFixture) => void)
      | undefined;

    queueAppWorkflowSessionUpload(buildRunWorkflowPersistedRecord(), {
      createAppWorkflowSession: (() =>
        new Promise<WorkflowSessionResponseFixture>((resolve) => {
          resolveUpload = resolve;
        })) as never,
      resolveRepositoryLink: () =>
        Promise.resolve({
          kind: "linked",
          localRepoKey: "repo-local-key",
        }),
      warningCache: new Set<string>(),
    });

    await settleAsync();
    await settleAsync();

    await expect(
      drainPendingAppWorkflowSessionUploads({ timeoutMs: 1 }),
    ).resolves.toMatchObject({
      kind: "timeout",
      startedPendingCount: 1,
      remainingPendingCount: 1,
    });

    resolveUpload?.(buildWorkflowSessionResponse());
    await expect(
      drainPendingAppWorkflowSessionUploads({ timeoutMs: 1_000 }),
    ).resolves.toEqual({
      kind: "drained",
      startedPendingCount: 1,
      remainingPendingCount: 0,
    });
  });

  it("aborts queued uploads that are still pending when drain times out", async () => {
    const warn = jest.fn();
    const observedSignals: AbortSignal[] = [];
    const createAppWorkflowSessionMock = jest.fn(
      (input: { signal?: AbortSignal }) =>
        new Promise<WorkflowSessionResponseFixture>((resolve, reject) => {
          void resolve;
          const signal = input.signal;
          if (!signal) {
            reject(new Error("Expected queued upload to receive a signal."));
            return;
          }

          observedSignals.push(signal);
          signal.addEventListener(
            "abort",
            () => {
              const reason =
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Queued upload aborted.");
              reject(reason);
            },
            {
              once: true,
            },
          );
        }),
    );

    queueAppWorkflowSessionUpload(buildRunWorkflowPersistedRecord(), {
      createAppWorkflowSession: createAppWorkflowSessionMock as never,
      resolveRepositoryLink: () =>
        Promise.resolve({
          kind: "linked",
          localRepoKey: "repo-local-key",
        }),
      warningCache: new Set<string>(),
      warn,
    });

    await settleAsync();
    await settleAsync();
    expect(createAppWorkflowSessionMock).toHaveBeenCalledTimes(1);

    await expect(
      drainPendingAppWorkflowSessionUploads({ timeoutMs: 1 }),
    ).resolves.toEqual({
      kind: "timeout",
      startedPendingCount: 1,
      remainingPendingCount: 1,
    });

    expect(observedSignals[0]?.aborted).toBe(true);
    await expect(
      drainPendingAppWorkflowSessionUploads({ timeoutMs: 1_000 }),
    ).resolves.toEqual({
      kind: "drained",
      startedPendingCount: 1,
      remainingPendingCount: 0,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("app workflow upload registration", () => {
  it("queues hosted uploads from neutral persisted workflow events", async () => {
    const createAppWorkflowSessionMock = jest.fn(
      (_input: {
        payload: AppWorkflowSessionUploadPayload;
        env?: NodeJS.ProcessEnv;
      }) => {
        void _input;
        return Promise.resolve(buildWorkflowSessionResponse());
      },
    );
    const unregister = registerAppWorkflowSessionUploadHandler({
      createAppWorkflowSession: createAppWorkflowSessionMock as never,
      resolveRepositoryLink: () =>
        Promise.resolve({
          kind: "linked",
          localRepoKey: "repo-local-key",
        }),
      warningCache: new Set<string>(),
    });

    try {
      await emitPersistedWorkflowRecordEvent(buildRunWorkflowPersistedRecord());
      await expect(
        drainPendingAppWorkflowSessionUploads({ timeoutMs: 1_000 }),
      ).resolves.toEqual({
        kind: "drained",
        startedPendingCount: 1,
        remainingPendingCount: 0,
      });

      expect(createAppWorkflowSessionMock).toHaveBeenCalledTimes(1);
      expect(createAppWorkflowSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            operator: "run",
            session_id: "run-123",
          }),
        }),
      );
    } finally {
      unregister();
    }
  });
});

describe("app workflow upload orchestration", () => {
  it("skips when the repository is not linked", async () => {
    const createAppWorkflowSessionMock = jest.fn();
    const ensureAppRepositoryConnectionMock = jest.fn();
    const buildRepositoryConnectionEnsureRequestMock = jest.fn();

    const outcome = await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest:
          buildRepositoryConnectionEnsureRequestMock as never,
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState(null)),
        warningCache: new Set<string>(),
      },
    );

    expect(outcome).toEqual({
      kind: "skipped",
      reason: "repository_not_linked",
    });
    expect(buildRepositoryConnectionEnsureRequestMock).not.toHaveBeenCalled();
    expect(ensureAppRepositoryConnectionMock).not.toHaveBeenCalled();
    expect(createAppWorkflowSessionMock).not.toHaveBeenCalled();
  });

  it("ensures repository connection just-in-time and uploads with derived local_repo_key", async () => {
    const createAppWorkflowSessionMock = jest.fn(
      (_input: {
        payload: AppWorkflowSessionUploadPayload;
        env?: NodeJS.ProcessEnv;
      }) => {
        void _input;
        return Promise.resolve(buildWorkflowSessionResponse());
      },
    );
    const ensureAppRepositoryConnectionMock = jest.fn(
      (_input: {
        env?: NodeJS.ProcessEnv;
        payload: Record<string, unknown>;
      }) => {
        void _input;
        return Promise.resolve(buildRepositoryEnsureResponseForUpload());
      },
    );
    const buildRepositoryConnectionEnsureRequestMock = jest.fn(
      (repoRoot: string) => {
        void repoRoot;
        return Promise.resolve(buildRepositoryEnsureRequestForUpload());
      },
    );

    const outcome = await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest:
          buildRepositoryConnectionEnsureRequestMock as never,
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache: new Set<string>(),
      },
    );

    expect(buildRepositoryConnectionEnsureRequestMock).toHaveBeenCalledWith(
      "/repo",
    );
    expect(ensureAppRepositoryConnectionMock).toHaveBeenCalledWith({
      env: process.env,
      payload: {
        local_repo_key: "repo-derived-key",
        slug: "repo",
      },
    });
    expect(createAppWorkflowSessionMock).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      kind: "uploaded",
      payload: expect.objectContaining({
        local_repo_key: "repo-derived-key",
        operator: "run",
      }),
    });
  });

  it("threads an upload abort signal through repository ensure and session create", async () => {
    const controller = new AbortController();
    const createAppWorkflowSessionMock = jest.fn(
      (_input: {
        payload: AppWorkflowSessionUploadPayload;
        env?: NodeJS.ProcessEnv;
        signal?: AbortSignal;
      }) => {
        void _input;
        return Promise.resolve(buildWorkflowSessionResponse());
      },
    );
    const ensureAppRepositoryConnectionMock = jest.fn(
      (_input: {
        env?: NodeJS.ProcessEnv;
        payload: Record<string, unknown>;
        signal?: AbortSignal;
      }) => {
        void _input;
        return Promise.resolve(buildRepositoryEnsureResponseForUpload());
      },
    );

    await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest: () =>
          Promise.resolve(buildRepositoryEnsureRequestForUpload()),
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache: new Set<string>(),
      },
      {
        signal: controller.signal,
      },
    );

    expect(ensureAppRepositoryConnectionMock).toHaveBeenCalledWith({
      env: process.env,
      payload: {
        local_repo_key: "repo-derived-key",
        slug: "repo",
      },
      signal: controller.signal,
    });
    expect(createAppWorkflowSessionMock).toHaveBeenCalledWith({
      env: process.env,
      payload: expect.objectContaining({
        local_repo_key: "repo-derived-key",
        operator: "run",
      }),
      signal: controller.signal,
    });
  });

  it("warns with login guidance and skips upload when ensure fails with auth/session errors", async () => {
    const warn = jest.fn();
    const createAppWorkflowSessionMock = jest.fn();
    const ensureAppRepositoryConnectionMock = jest.fn(() =>
      Promise.reject(new AppApiError("Unauthorized", "unauthorized", 401)),
    );

    const outcome = await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest: () =>
          Promise.resolve(buildRepositoryEnsureRequestForUpload()),
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache: new Set<string>(),
        warn,
      },
    );

    expect(outcome).toEqual({
      kind: "skipped",
      reason: "backend_link_missing",
    });
    expect(createAppWorkflowSessionMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[voratiq] App workflow upload skipped. Run `voratiq login`.",
    );
  });

  it("warns once per repo and avoids login guidance for non-auth ensure failures", async () => {
    const warn = jest.fn();
    const warningCache = new Set<string>();
    const createAppWorkflowSessionMock = jest.fn();
    const ensureAppRepositoryConnectionMock = jest.fn(() =>
      Promise.reject(new Error("network exploded")),
    );

    const first = await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest: () =>
          Promise.resolve(buildRepositoryEnsureRequestForUpload()),
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache,
        warn,
      },
    );

    const second = await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest: () =>
          Promise.resolve(buildRepositoryEnsureRequestForUpload()),
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache,
        warn,
      },
    );

    expect(first).toEqual({
      kind: "skipped",
      reason: "backend_link_missing",
    });
    expect(second).toEqual({
      kind: "skipped",
      reason: "backend_link_missing",
    });
    expect(createAppWorkflowSessionMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "could not confirm repository link with Voratiq App (network exploded)",
    );
    expect(warn.mock.calls[0]?.[0]).toContain("Run `voratiq status`");
    expect(warn.mock.calls[0]?.[0]).not.toContain("Run `voratiq login`");
  });

  it("calls ensure before each linked upload attempt", async () => {
    const createAppWorkflowSessionMock = jest.fn(() =>
      Promise.resolve(buildWorkflowSessionResponse()),
    );
    const ensureAppRepositoryConnectionMock = jest.fn(() =>
      Promise.resolve(buildRepositoryEnsureResponseForUpload()),
    );

    await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest: () =>
          Promise.resolve(buildRepositoryEnsureRequestForUpload()),
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache: new Set<string>(),
      },
    );

    await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: createAppWorkflowSessionMock as never,
        ensureAppRepositoryConnection:
          ensureAppRepositoryConnectionMock as never,
        buildRepositoryConnectionEnsureRequest: () =>
          Promise.resolve(buildRepositoryEnsureRequestForUpload()),
        readAppSessionState: readSignedInAppSessionState,
        readRepositoryLinkStateForRepoRoot: () =>
          Promise.resolve(buildLinkedRepositoryState()),
        warningCache: new Set<string>(),
      },
    );

    expect(ensureAppRepositoryConnectionMock).toHaveBeenCalledTimes(2);
    expect(createAppWorkflowSessionMock).toHaveBeenCalledTimes(2);
  });

  it("does not throw when hosted upload fails", async () => {
    const warn = jest.fn();

    await expect(
      uploadAppWorkflowSessionBestEffort(buildRunWorkflowPersistedRecord(), {
        createAppWorkflowSession: () =>
          Promise.reject(new Error("network exploded")),
        resolveRepositoryLink: () =>
          Promise.resolve({
            kind: "linked",
            localRepoKey: "repo-local-key",
          }),
        warningCache: new Set<string>(),
        warn,
      }),
    ).resolves.toMatchObject({
      kind: "warning",
      reason: "upload_failed",
    });

    expect(warn).toHaveBeenCalledWith(
      "[voratiq] App workflow upload failed for run run-123 (network exploded). Run `voratiq status` to verify your account.",
    );
  });

  it("treats repository_not_linked API responses as a backend link blocker", async () => {
    const outcome = await uploadAppWorkflowSessionBestEffort(
      buildRunWorkflowPersistedRecord(),
      {
        createAppWorkflowSession: () =>
          Promise.reject(
            new AppApiError(
              "Repository not linked",
              "repository_not_linked",
              409,
            ),
          ),
        resolveRepositoryLink: () =>
          Promise.resolve({
            kind: "linked",
            localRepoKey: "repo-local-key",
          }),
        warningCache: new Set<string>(),
      },
    );

    expect(outcome).toEqual({
      kind: "skipped",
      reason: "backend_link_missing",
    });
  });
});

async function settleAsync(): Promise<void> {
  await Promise.resolve();
}
