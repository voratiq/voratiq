import {
  type PersistedWorkflowRecordEvent,
  subscribePersistedWorkflowRecordEvents,
} from "../domain/shared/workflow-record-events.js";
import { toErrorMessage } from "../utils/errors.js";
import { AppApiError, isAbortError } from "./api-client.js";
import {
  AppSessionAuthError,
  type AppSessionAuthErrorCode,
} from "./authenticated-api.js";
import { ensureAppRepositoryConnection } from "./repository-connections.js";
import { buildRepositoryConnectionEnsureRequest } from "./repository-link-sync.js";
import {
  readAppSessionState,
  readRepositoryLinkStateForRepoRoot,
} from "./state.js";
import {
  type AppWorkflowSessionResponse,
  createAppWorkflowSession,
} from "./workflow-sessions.js";

export type AppWorkflowSessionOperator =
  | "message"
  | "reduce"
  | "run"
  | "spec"
  | "verify";

export type AppWorkflowSessionTargetKind =
  | "interactive"
  | "message"
  | "reduce"
  | "run"
  | "spec"
  | "verify";

export interface AppWorkflowSessionUploadTarget {
  kind: AppWorkflowSessionTargetKind;
  session_id: string;
}

export type AppWorkflowSessionUploadPayload = Readonly<
  Record<string, unknown>
> & {
  local_repo_key: string;
  operator: AppWorkflowSessionOperator;
  session_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  record_updated_at: string;
  raw_record: Record<string, unknown>;
  target?: AppWorkflowSessionUploadTarget;
};

export type AppWorkflowPersistedRecord = PersistedWorkflowRecordEvent;

export type AppWorkflowRepositoryLinkResolution =
  | { kind: "repository_not_linked" }
  | { kind: "backend_link_missing"; message?: string }
  | { kind: "aborted" }
  | { kind: "linked"; localRepoKey: string };

export type AppWorkflowSessionUploadOutcome =
  | {
      kind: "skipped";
      reason: "repository_not_linked" | "backend_link_missing" | "aborted";
    }
  | {
      kind: "uploaded";
      payload: AppWorkflowSessionUploadPayload;
      response: AppWorkflowSessionResponse;
    }
  | {
      kind: "warning";
      reason: "login_required" | "upload_failed";
      message: string;
    };

export type AppWorkflowSessionUploadDrainOutcome =
  | {
      kind: "drained";
      startedPendingCount: number;
      remainingPendingCount: 0;
    }
  | {
      kind: "timeout";
      startedPendingCount: number;
      remainingPendingCount: number;
    };

interface AppWorkflowUploadDependencies {
  createAppWorkflowSession: typeof createAppWorkflowSession;
  readAppSessionState: typeof readAppSessionState;
  readRepositoryLinkStateForRepoRoot: typeof readRepositoryLinkStateForRepoRoot;
  ensureAppRepositoryConnection: typeof ensureAppRepositoryConnection;
  buildRepositoryConnectionEnsureRequest: typeof buildRepositoryConnectionEnsureRequest;
  resolveRepositoryLink: (options: {
    root: string;
    env: NodeJS.ProcessEnv;
    readAppSessionState: typeof readAppSessionState;
    readRepositoryLinkStateForRepoRoot: typeof readRepositoryLinkStateForRepoRoot;
    ensureAppRepositoryConnection: typeof ensureAppRepositoryConnection;
    buildRepositoryConnectionEnsureRequest: typeof buildRepositoryConnectionEnsureRequest;
    signal?: AbortSignal;
  }) => Promise<AppWorkflowRepositoryLinkResolution>;
  warn: (message: string) => void;
  warningCache: Set<string>;
}

interface AppWorkflowUploadWarningBufferStore {
  closed: boolean;
  warnings: string[];
}

interface PendingAppWorkflowSessionUpload {
  abortController: AbortController;
  promise: Promise<AppWorkflowSessionUploadOutcome>;
}

export interface AppWorkflowUploadWarningBuffer {
  install(): () => void;
  run<T>(action: () => Promise<T>): Promise<T>;
  closeAndDrain(): string[];
}

export interface UploadAppWorkflowSessionBestEffortOptions {
  signal?: AbortSignal;
}

const DEFAULT_UPLOAD_DRAIN_TIMEOUT_MS = 5_000;

export function buildAppWorkflowSessionUploadPayload(
  input: AppWorkflowPersistedRecord & {
    localRepoKey: string;
  },
): AppWorkflowSessionUploadPayload {
  switch (input.operator) {
    case "spec":
      return {
        local_repo_key: input.localRepoKey,
        operator: "spec",
        session_id: input.record.sessionId,
        status: input.record.status,
        created_at: input.record.createdAt,
        started_at: input.record.startedAt ?? null,
        completed_at: input.record.completedAt ?? null,
        record_updated_at: input.recordUpdatedAt,
        raw_record: cloneRawRecord(input.record),
      };
    case "message":
      return {
        local_repo_key: input.localRepoKey,
        operator: "message",
        session_id: input.record.sessionId,
        status: input.record.status,
        created_at: input.record.createdAt,
        started_at: input.record.startedAt ?? null,
        completed_at: input.record.completedAt ?? null,
        record_updated_at: input.recordUpdatedAt,
        raw_record: cloneRawRecord(input.record),
        ...(input.record.target
          ? {
              target: {
                kind: input.record.target.kind,
                session_id: input.record.target.sessionId,
              } satisfies AppWorkflowSessionUploadTarget,
            }
          : {}),
      };
    case "reduce":
      return {
        local_repo_key: input.localRepoKey,
        operator: "reduce",
        session_id: input.record.sessionId,
        status: input.record.status,
        created_at: input.record.createdAt,
        started_at: input.record.startedAt ?? null,
        completed_at: input.record.completedAt ?? null,
        record_updated_at: input.recordUpdatedAt,
        raw_record: cloneRawRecord(input.record),
        target: {
          kind: input.record.target.type,
          session_id: input.record.target.id,
        },
      };
    case "verify":
      return {
        local_repo_key: input.localRepoKey,
        operator: "verify",
        session_id: input.record.sessionId,
        status: input.record.status,
        created_at: input.record.createdAt,
        started_at: input.record.startedAt ?? null,
        completed_at: input.record.completedAt ?? null,
        record_updated_at: input.recordUpdatedAt,
        raw_record: cloneRawRecord(input.record),
        target: {
          kind: input.record.target.kind,
          session_id: input.record.target.sessionId,
        },
      };
    case "run":
      return {
        local_repo_key: input.localRepoKey,
        operator: "run",
        session_id: input.record.runId,
        status: input.record.status,
        created_at: input.record.createdAt,
        started_at: input.record.startedAt ?? null,
        completed_at: input.record.completedAt ?? null,
        record_updated_at: input.recordUpdatedAt,
        raw_record: cloneRawRecord(input.record),
        ...(input.record.spec.target?.kind === "spec"
          ? {
              target: {
                kind: "spec",
                session_id: input.record.spec.target.sessionId,
              } satisfies AppWorkflowSessionUploadTarget,
            }
          : {}),
      };
  }
}

export async function uploadAppWorkflowSessionBestEffort(
  input: AppWorkflowPersistedRecord,
  dependencies: Partial<AppWorkflowUploadDependencies> = {},
  options: UploadAppWorkflowSessionBestEffortOptions = {},
): Promise<AppWorkflowSessionUploadOutcome> {
  const env = input.env ?? process.env;
  const deps: AppWorkflowUploadDependencies = {
    createAppWorkflowSession,
    readAppSessionState,
    readRepositoryLinkStateForRepoRoot,
    ensureAppRepositoryConnection,
    buildRepositoryConnectionEnsureRequest,
    resolveRepositoryLink: resolveAppWorkflowRepositoryLink,
    warn: emitAppWorkflowUploadWarning,
    warningCache: sharedWarningCache,
    ...dependencies,
  };

  if (isUploadSignalAborted(options.signal)) {
    return {
      kind: "skipped",
      reason: "aborted",
    };
  }

  let resolution: AppWorkflowRepositoryLinkResolution;
  try {
    resolution = await deps.resolveRepositoryLink({
      root: input.root,
      env,
      readAppSessionState: deps.readAppSessionState,
      readRepositoryLinkStateForRepoRoot:
        deps.readRepositoryLinkStateForRepoRoot,
      ensureAppRepositoryConnection: deps.ensureAppRepositoryConnection,
      buildRepositoryConnectionEnsureRequest:
        deps.buildRepositoryConnectionEnsureRequest,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortForSignal(error, options.signal)) {
      return {
        kind: "skipped",
        reason: "aborted",
      };
    }

    const message = `[voratiq] App workflow upload failed for ${describeAppWorkflowRecord(input)} (${toErrorMessage(error)}). Run \`voratiq status\` to verify your account.`;
    warnOnce({
      cache: deps.warningCache,
      key: `resolve:${input.root}`,
      warn: deps.warn,
      message,
    });
    return {
      kind: "warning",
      reason: "upload_failed",
      message,
    };
  }

  if (resolution.kind === "aborted") {
    return {
      kind: "skipped",
      reason: "aborted",
    };
  }

  if (resolution.kind === "repository_not_linked") {
    return {
      kind: "skipped",
      reason: "repository_not_linked",
    };
  }

  if (resolution.kind === "backend_link_missing") {
    if (resolution.message) {
      warnOnce({
        cache: deps.warningCache,
        key: `ensure:${input.root}`,
        warn: deps.warn,
        message: resolution.message,
      });
    }
    return {
      kind: "skipped",
      reason: "backend_link_missing",
    };
  }

  const payload = buildAppWorkflowSessionUploadPayload({
    ...input,
    localRepoKey: resolution.localRepoKey,
  });

  if (isUploadSignalAborted(options.signal)) {
    return {
      kind: "skipped",
      reason: "aborted",
    };
  }

  try {
    const response = await deps.createAppWorkflowSession({
      payload,
      env,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      kind: "uploaded",
      payload,
      response,
    };
  } catch (error) {
    if (isAbortForSignal(error, options.signal)) {
      return {
        kind: "skipped",
        reason: "aborted",
      };
    }

    if (isBackendRepositoryLinkMissingError(error)) {
      return {
        kind: "skipped",
        reason: "backend_link_missing",
      };
    }

    const warning = buildUploadWarning({
      input,
      error,
    });
    warnOnce({
      cache: deps.warningCache,
      key: warning.key,
      warn: deps.warn,
      message: warning.message,
    });
    return {
      kind: "warning",
      reason: warning.reason,
      message: warning.message,
    };
  }
}

export function queueAppWorkflowSessionUpload(
  input: AppWorkflowPersistedRecord,
  dependencies: Partial<AppWorkflowUploadDependencies> = {},
): void {
  const abortController = new AbortController();
  let pendingEntry: PendingAppWorkflowSessionUpload | undefined;
  const promise = uploadAppWorkflowSessionBestEffort(input, dependencies, {
    signal: abortController.signal,
  })
    .catch((error): AppWorkflowSessionUploadOutcome => {
      const warning = buildUploadWarning({ input, error });
      warnOnce({
        cache: sharedWarningCache,
        key: warning.key,
        warn: emitAppWorkflowUploadWarning,
        message: warning.message,
      });
      return {
        kind: "warning",
        reason: warning.reason,
        message: warning.message,
      };
    })
    .finally(() => {
      if (pendingEntry) {
        pendingAppWorkflowSessionUploads.delete(pendingEntry);
      }
    });

  pendingEntry = {
    abortController,
    promise,
  };
  pendingAppWorkflowSessionUploads.add(pendingEntry);
}

export function registerAppWorkflowSessionUploadHandler(
  dependencies: Partial<AppWorkflowUploadDependencies> = {},
): () => void {
  if (unregisterWorkflowUploadHandler) {
    return unregisterWorkflowUploadHandler;
  }

  const unsubscribe = subscribePersistedWorkflowRecordEvents((event) => {
    queueAppWorkflowSessionUpload(event, dependencies);
  });

  unregisterWorkflowUploadHandler = () => {
    unregisterWorkflowUploadHandler = undefined;
    unsubscribe();
  };

  return unregisterWorkflowUploadHandler;
}

export async function drainPendingAppWorkflowSessionUploads(
  options: {
    timeoutMs?: number;
  } = {},
): Promise<AppWorkflowSessionUploadDrainOutcome> {
  const startedPendingCount = pendingAppWorkflowSessionUploads.size;
  if (startedPendingCount === 0) {
    return {
      kind: "drained",
      startedPendingCount,
      remainingPendingCount: 0,
    };
  }

  const timeoutMs = normalizeUploadDrainTimeoutMs(options.timeoutMs);
  const pendingAtStart = Array.from(pendingAppWorkflowSessionUploads);
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const result = await Promise.race([
    Promise.allSettled(pendingAtStart.map((entry) => entry.promise)).then(
      () => "drained" as const,
    ),
    timeoutPromise,
  ]);

  if (timeout) {
    clearTimeout(timeout);
  }

  if (result === "timeout") {
    const pendingAtTimeout = Array.from(pendingAppWorkflowSessionUploads);
    for (const entry of pendingAtTimeout) {
      entry.abortController.abort();
    }

    return {
      kind: "timeout",
      startedPendingCount,
      remainingPendingCount: pendingAtTimeout.length,
    };
  }

  const remainingPendingCount = pendingAppWorkflowSessionUploads.size;
  if (result === "drained" && remainingPendingCount === 0) {
    return {
      kind: "drained",
      startedPendingCount,
      remainingPendingCount: 0,
    };
  }

  return {
    kind: "timeout",
    startedPendingCount,
    remainingPendingCount,
  };
}

export function createAppWorkflowUploadWarningBuffer(): AppWorkflowUploadWarningBuffer {
  const store: AppWorkflowUploadWarningBufferStore = {
    closed: false,
    warnings: [],
  };

  return {
    install(): () => void {
      appWorkflowUploadWarningBufferStack.push(store);
      return () => {
        const index = appWorkflowUploadWarningBufferStack.lastIndexOf(store);
        if (index >= 0) {
          appWorkflowUploadWarningBufferStack.splice(index, 1);
        }
      };
    },
    run<T>(action: () => Promise<T>): Promise<T> {
      const restore = this.install();
      return Promise.resolve()
        .then(action)
        .finally(() => restore());
    },
    closeAndDrain(): string[] {
      store.closed = true;
      const warnings = [...store.warnings];
      store.warnings.length = 0;
      return warnings;
    },
  };
}

async function resolveAppWorkflowRepositoryLink(options: {
  root: string;
  env: NodeJS.ProcessEnv;
  readAppSessionState: typeof readAppSessionState;
  readRepositoryLinkStateForRepoRoot: typeof readRepositoryLinkStateForRepoRoot;
  ensureAppRepositoryConnection: typeof ensureAppRepositoryConnection;
  buildRepositoryConnectionEnsureRequest: typeof buildRepositoryConnectionEnsureRequest;
  signal?: AbortSignal;
}): Promise<AppWorkflowRepositoryLinkResolution> {
  if (isUploadSignalAborted(options.signal)) {
    return { kind: "aborted" };
  }

  const appSessionState = await options.readAppSessionState(options.env);
  const accountId = appSessionState.raw?.actor.id;
  if (
    !appSessionState.exists ||
    appSessionState.refreshTokenExpired === true ||
    !accountId
  ) {
    return {
      kind: "backend_link_missing",
      message: "[voratiq] App workflow upload skipped. Run `voratiq login`.",
    };
  }

  const linkState = await options.readRepositoryLinkStateForRepoRoot(
    options.root,
    options.env,
    accountId,
  );

  if (isUploadSignalAborted(options.signal)) {
    return { kind: "aborted" };
  }

  if (linkState.linked !== true) {
    return { kind: "repository_not_linked" };
  }

  const ensurePayload = await options.buildRepositoryConnectionEnsureRequest(
    options.root,
  );

  if (isUploadSignalAborted(options.signal)) {
    return { kind: "aborted" };
  }

  try {
    await options.ensureAppRepositoryConnection({
      env: options.env,
      payload: ensurePayload,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      kind: "linked",
      localRepoKey: ensurePayload.local_repo_key,
    };
  } catch (error) {
    if (isAbortForSignal(error, options.signal)) {
      return { kind: "aborted" };
    }

    return {
      kind: "backend_link_missing",
      message: buildEnsureWarning(error),
    };
  }
}

function buildUploadWarning(options: {
  input: AppWorkflowPersistedRecord;
  error: unknown;
}): {
  key: string;
  reason: "login_required" | "upload_failed";
  message: string;
} {
  const { input, error } = options;
  if (isLoginRequiredError(error)) {
    return {
      key: `login:${input.root}`,
      reason: "login_required",
      message: "[voratiq] App workflow upload skipped. Run `voratiq login`.",
    };
  }

  return {
    key: `upload:${input.operator}:${getAppWorkflowSessionId(input)}`,
    reason: "upload_failed",
    message: `[voratiq] App workflow upload failed for ${describeAppWorkflowRecord(input)} (${toErrorMessage(error)}). Run \`voratiq status\` to verify your account.`,
  };
}

function isLoginRequiredError(error: unknown): boolean {
  if (error instanceof AppSessionAuthError) {
    return LOGIN_REQUIRED_AUTH_ERROR_CODES.includes(error.code);
  }

  return (
    error instanceof AppApiError &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

function isUploadSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function isAbortForSignal(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true || (signal !== undefined && isAbortError(error))
  );
}

function buildEnsureWarning(error: unknown): string {
  if (isLoginRequiredError(error)) {
    return "[voratiq] App workflow upload skipped. Run `voratiq login`.";
  }

  return `[voratiq] App workflow upload skipped: could not confirm repository link with Voratiq App (${toErrorMessage(error)}). Run \`voratiq status\` to check the link.`;
}

function isBackendRepositoryLinkMissingError(error: unknown): boolean {
  return error instanceof AppApiError && error.code === "repository_not_linked";
}

function getAppWorkflowSessionId(input: AppWorkflowPersistedRecord): string {
  return input.operator === "run" ? input.record.runId : input.record.sessionId;
}

function describeAppWorkflowRecord(input: AppWorkflowPersistedRecord): string {
  return `${input.operator} ${getAppWorkflowSessionId(input)}`;
}

function cloneRawRecord<RecordType extends Record<string, unknown>>(
  record: RecordType,
): Record<string, unknown> {
  return structuredClone(record);
}

function warnOnce(options: {
  cache: Set<string>;
  key: string;
  warn: (message: string) => void;
  message: string;
}): void {
  if (options.cache.has(options.key)) {
    return;
  }
  options.cache.add(options.key);
  options.warn(options.message);
}

function emitAppWorkflowUploadWarning(message: string): void {
  const store =
    appWorkflowUploadWarningBufferStack[
      appWorkflowUploadWarningBufferStack.length - 1
    ];
  if (!store || store.closed) {
    console.warn(message);
    return;
  }

  store.warnings.push(message);
}

const LOGIN_REQUIRED_AUTH_ERROR_CODES = [
  "session_expired",
  "session_missing",
  "refresh_failed",
  "session_read_failed",
  "session_write_failed",
  "invalid_refresh_response",
] as const satisfies readonly AppSessionAuthErrorCode[];

const sharedWarningCache = new Set<string>();
const appWorkflowUploadWarningBufferStack: AppWorkflowUploadWarningBufferStore[] =
  [];
const pendingAppWorkflowSessionUploads =
  new Set<PendingAppWorkflowSessionUpload>();
let unregisterWorkflowUploadHandler: (() => void) | undefined;

function normalizeUploadDrainTimeoutMs(timeoutMs: number | undefined): number {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0
  ) {
    return DEFAULT_UPLOAD_DRAIN_TIMEOUT_MS;
  }

  return Math.trunc(timeoutMs);
}
