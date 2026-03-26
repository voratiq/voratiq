import { z } from "zod";

export interface LifecycleStatusGroups<TStatus extends string> {
  queued: readonly TStatus[];
  running: readonly TStatus[];
  terminal: readonly TStatus[];
}

interface TimestampLifecycleRecord<TStatus extends string> {
  status: TStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface LifecycleExecutionDurationInput<TStatus extends string> {
  status: TStatus;
  startedAt?: string;
  completedAt?: string;
}

interface RecordTimestampLifecycle<TStatus extends string>
  extends TimestampLifecycleRecord<TStatus> {
  createdAt: string;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function addIssue(ctx: z.RefinementCtx, path: string, message: string): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message,
  });
}

function includesStatus<TStatus extends string>(
  statuses: readonly TStatus[],
  status: TStatus,
): boolean {
  return statuses.includes(status);
}

export function resolveLifecycleExecutionDurationMs<TStatus extends string>(
  lifecycle: LifecycleExecutionDurationInput<TStatus>,
  options: {
    statusGroups: Pick<LifecycleStatusGroups<TStatus>, "running" | "terminal">;
    now?: number;
  },
): number | undefined {
  const startedAtTime = parseTimestamp(lifecycle.startedAt);
  if (startedAtTime === undefined) {
    return undefined;
  }

  const { statusGroups } = options;
  if (includesStatus(statusGroups.running, lifecycle.status)) {
    const nowTime = options.now ?? Date.now();
    if (!Number.isFinite(nowTime) || nowTime < startedAtTime) {
      return undefined;
    }
    return nowTime - startedAtTime;
  }

  if (includesStatus(statusGroups.terminal, lifecycle.status)) {
    const completedAtTime = parseTimestamp(lifecycle.completedAt);
    if (completedAtTime === undefined || completedAtTime < startedAtTime) {
      return undefined;
    }
    return completedAtTime - startedAtTime;
  }

  return undefined;
}

export function validateRecordLifecycleTimestamps<TStatus extends string>(
  record: RecordTimestampLifecycle<TStatus>,
  ctx: z.RefinementCtx,
  groups: LifecycleStatusGroups<TStatus>,
): void {
  const { createdAt, startedAt, completedAt, status } = record;

  const isQueued = includesStatus(groups.queued, status);
  const isRunning = includesStatus(groups.running, status);
  const isTerminal = includesStatus(groups.terminal, status);

  /**
   * Canonical lifecycle timestamp contract:
   * - queued: `startedAt` and `completedAt` MUST be omitted
   * - running: `startedAt` is required; `completedAt` MUST be omitted
   * - terminal: `startedAt` and `completedAt` are required
   *
   * Record-level invariants:
   * - `startedAt` must be >= `createdAt`
   * - `completedAt` must be >= `startedAt`
   */
  if (isQueued) {
    if (startedAt) {
      addIssue(
        ctx,
        "startedAt",
        "startedAt must be omitted while record status is queued",
      );
    }
    if (completedAt) {
      addIssue(
        ctx,
        "completedAt",
        "completedAt must be omitted while record status is queued",
      );
    }
    return;
  }

  if (isRunning) {
    if (!startedAt) {
      addIssue(
        ctx,
        "startedAt",
        "startedAt is required once record status is running",
      );
    }
    if (completedAt) {
      addIssue(
        ctx,
        "completedAt",
        "completedAt must be omitted while record status is running",
      );
    }
  }

  if (isTerminal) {
    if (!startedAt) {
      addIssue(
        ctx,
        "startedAt",
        "startedAt is required once record status is terminal",
      );
    }
    if (!completedAt) {
      addIssue(
        ctx,
        "completedAt",
        "completedAt is required once record status is terminal",
      );
    }
  }

  const createdAtTime = parseTimestamp(createdAt);
  const startedAtTime = parseTimestamp(startedAt);
  const completedAtTime = parseTimestamp(completedAt);

  if (
    createdAtTime !== undefined &&
    startedAtTime !== undefined &&
    startedAtTime < createdAtTime
  ) {
    addIssue(
      ctx,
      "startedAt",
      "startedAt must be greater than or equal to createdAt",
    );
  }

  if (
    completedAtTime !== undefined &&
    startedAtTime !== undefined &&
    completedAtTime < startedAtTime
  ) {
    addIssue(
      ctx,
      "completedAt",
      "completedAt must be greater than or equal to startedAt",
    );
  }
}

export function validateOperationLifecycleTimestamps<TStatus extends string>(
  record: TimestampLifecycleRecord<TStatus>,
  ctx: z.RefinementCtx,
  groups: LifecycleStatusGroups<TStatus>,
): void {
  const { startedAt, completedAt, status } = record;

  const isQueued = includesStatus(groups.queued, status);
  const isRunning = includesStatus(groups.running, status);
  const isTerminal = includesStatus(groups.terminal, status);

  if (isQueued) {
    if (startedAt) {
      addIssue(
        ctx,
        "startedAt",
        "startedAt must be omitted while record status is queued",
      );
    }
    if (completedAt) {
      addIssue(
        ctx,
        "completedAt",
        "completedAt must be omitted while record status is queued",
      );
    }
    return;
  }

  if (isRunning) {
    if (!startedAt) {
      addIssue(
        ctx,
        "startedAt",
        "startedAt is required once record status is running",
      );
    }
    if (completedAt) {
      addIssue(
        ctx,
        "completedAt",
        "completedAt must be omitted while record status is running",
      );
    }
  }

  if (isTerminal) {
    if (!startedAt) {
      addIssue(
        ctx,
        "startedAt",
        "startedAt is required once record status is terminal",
      );
    }
    if (!completedAt) {
      addIssue(
        ctx,
        "completedAt",
        "completedAt is required once record status is terminal",
      );
    }
  }

  const startedAtTime = parseTimestamp(startedAt);
  const completedAtTime = parseTimestamp(completedAt);

  if (
    completedAtTime !== undefined &&
    startedAtTime !== undefined &&
    completedAtTime < startedAtTime
  ) {
    addIssue(
      ctx,
      "completedAt",
      "completedAt must be greater than or equal to startedAt",
    );
  }
}

export function buildLifecycleStartFields(options: {
  existingStartedAt: string | undefined;
  timestamp?: string;
}): { startedAt: string } {
  return {
    startedAt:
      options.existingStartedAt ??
      options.timestamp ??
      new Date().toISOString(),
  };
}

export function buildRecordLifecycleCompleteFields(options: {
  existing: { startedAt?: string; completedAt?: string };
  startedAt?: string;
  completedAt?: string;
}): { startedAt: string; completedAt: string } {
  const completedAt =
    options.completedAt ??
    options.existing.completedAt ??
    new Date().toISOString();
  const startedAt = options.existing.startedAt ?? options.startedAt;
  if (!startedAt) {
    throw new Error(
      "Record lifecycle completion requires canonical startedAt.",
    );
  }
  return {
    startedAt,
    completedAt,
  };
}

export function buildOperationLifecycleCompleteFields(options: {
  existing: { startedAt?: string; completedAt?: string };
  startedAt?: string;
  completedAt?: string;
}): { startedAt: string; completedAt: string } {
  const completedAt =
    options.completedAt ??
    options.existing.completedAt ??
    new Date().toISOString();
  const startedAt = options.existing.startedAt ?? options.startedAt;
  if (!startedAt) {
    throw new Error(
      "Operation lifecycle completion requires canonical startedAt.",
    );
  }
  return {
    startedAt,
    completedAt,
  };
}
