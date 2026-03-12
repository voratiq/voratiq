import {
  type LifecycleExecutionDurationInput,
  resolveLifecycleExecutionDurationMs,
} from "../../domains/shared/lifecycle.js";

export function resolveRenderLifecycleDurationMs<
  TStatus extends string,
>(options: {
  lifecycle: LifecycleExecutionDurationInput<TStatus>;
  terminalStatuses: readonly TStatus[];
  now?: number;
}): number | undefined {
  return resolveLifecycleExecutionDurationMs(options.lifecycle, {
    statusGroups: {
      running: ["running" as TStatus],
      terminal: options.terminalStatuses,
    },
    now: options.now,
  });
}

export function formatRenderLifecycleDuration<TStatus extends string>(options: {
  lifecycle: LifecycleExecutionDurationInput<TStatus>;
  terminalStatuses: readonly TStatus[];
  now?: number;
}): string | undefined {
  const durationMs = resolveRenderLifecycleDurationMs(options);
  if (durationMs === undefined) {
    return undefined;
  }

  return formatDurationLabel(durationMs);
}

export function formatDurationLabel(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}
