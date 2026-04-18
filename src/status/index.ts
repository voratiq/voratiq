import { z } from "zod";

export const RUN_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "errored",
  "aborted",
] as const;

export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export const runStatusSchema = z.enum(RUN_STATUS_VALUES);

/**
 * Derive the terminal run status from agent outcomes.
 * Returns "succeeded" when at least one agent succeeds; otherwise "failed".
 */
export function deriveRunStatusFromAgents(
  agentStatuses: readonly AgentStatus[],
): RunStatus {
  const hasAgentSuccess = agentStatuses.some(
    (status) => status === "succeeded",
  );
  return hasAgentSuccess ? "succeeded" : "failed";
}

/**
 * Map a terminal run status to a deterministic process exit code.
 * Throws when invoked with a non-terminal status to avoid contradictory pairs.
 */
export function mapRunStatusToExitCode(status: RunStatus): number {
  switch (status) {
    case "succeeded":
      return 0;
    case "failed":
      return 1;
    case "errored":
      return 2;
    case "aborted":
      return 3;
    default:
      throw new Error(
        `Cannot map non-terminal run status \`${status}\` to an exit code.`,
      );
  }
}

/**
 * Run statuses that indicate the run has finished execution.
 */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "succeeded",
  "failed",
  "errored",
  "aborted",
] as const satisfies readonly RunStatus[];

/**
 * Run statuses that indicate the run is queued or executing.
 */
export const IN_PROGRESS_RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "running",
] as const satisfies readonly RunStatus[];

/**
 * Run statuses that allow forced termination (e.g., abort or fail).
 */
export const TERMINABLE_RUN_STATUSES: readonly RunStatus[] = [
  "failed",
  "aborted",
] as const satisfies readonly RunStatus[];

export const AGENT_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "errored",
  "skipped",
  "aborted",
] as const;

export type AgentStatus = (typeof AGENT_STATUS_VALUES)[number];

export const agentStatusSchema = z.enum(AGENT_STATUS_VALUES);

/**
 * Agent statuses that indicate the agent has finished execution.
 */
export const TERMINAL_AGENT_STATUSES: readonly AgentStatus[] = [
  "succeeded",
  "failed",
  "errored",
  "skipped",
  "aborted",
] as const satisfies readonly AgentStatus[];

/**
 * Agent statuses that indicate the agent is still running or waiting.
 */
export const IN_PROGRESS_AGENT_STATUSES: readonly AgentStatus[] = [
  "queued",
  "running",
] as const satisfies readonly AgentStatus[];

export const CHECK_STATUS_VALUES = [
  "succeeded",
  "failed",
  "errored",
  "skipped",
] as const;

export type CheckStatus = (typeof CHECK_STATUS_VALUES)[number];

export const checkStatusSchema = z.enum(CHECK_STATUS_VALUES);

export const APPLY_STATUS_VALUES = ["succeeded", "failed"] as const;

export type ApplyStatus = (typeof APPLY_STATUS_VALUES)[number];

export const applyStatusSchema = z.enum(APPLY_STATUS_VALUES);

export const VERIFICATION_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborted",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUS_VALUES)[number];

export const verificationStatusSchema = z.enum(VERIFICATION_STATUS_VALUES);

export const TERMINAL_VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "succeeded",
  "failed",
  "aborted",
] as const satisfies readonly VerificationStatus[];

export const IN_PROGRESS_VERIFICATION_STATUSES: readonly VerificationStatus[] =
  ["queued", "running"] as const satisfies readonly VerificationStatus[];

export const REDUCTION_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborted",
] as const;

export type ReductionStatus = (typeof REDUCTION_STATUS_VALUES)[number];

export const reductionStatusSchema = z.enum(REDUCTION_STATUS_VALUES);

/**
 * Reduction statuses that indicate the reduction session has finished.
 */
export const TERMINAL_REDUCTION_STATUSES: readonly ReductionStatus[] = [
  "succeeded",
  "failed",
  "aborted",
] as const satisfies readonly ReductionStatus[];

export const IN_PROGRESS_REDUCTION_STATUSES: readonly ReductionStatus[] = [
  "queued",
  "running",
] as const satisfies readonly ReductionStatus[];

export const MESSAGE_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborted",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUS_VALUES)[number];

export const messageStatusSchema = z.enum(MESSAGE_STATUS_VALUES);

export const TERMINAL_MESSAGE_STATUSES: readonly MessageStatus[] = [
  "succeeded",
  "failed",
  "aborted",
] as const satisfies readonly MessageStatus[];

export const IN_PROGRESS_MESSAGE_STATUSES: readonly MessageStatus[] = [
  "queued",
  "running",
] as const satisfies readonly MessageStatus[];

export const MESSAGE_RECIPIENT_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborted",
] as const;

export type MessageRecipientStatus =
  (typeof MESSAGE_RECIPIENT_STATUS_VALUES)[number];

export const messageRecipientStatusSchema = z.enum(
  MESSAGE_RECIPIENT_STATUS_VALUES,
);

export const TERMINAL_MESSAGE_RECIPIENT_STATUSES: readonly MessageRecipientStatus[] =
  [
    "succeeded",
    "failed",
    "aborted",
  ] as const satisfies readonly MessageRecipientStatus[];

export const SPEC_RECORD_STATUS_VALUES = [
  "running",
  "succeeded",
  "aborted",
  "failed",
] as const;

export type SpecRecordStatus = (typeof SPEC_RECORD_STATUS_VALUES)[number];

export const specRecordStatusSchema = z.enum(SPEC_RECORD_STATUS_VALUES);

/**
 * Spec record statuses that indicate the spec session has finished.
 */
export const TERMINAL_SPEC_STATUSES: readonly SpecRecordStatus[] = [
  "succeeded",
  "aborted",
  "failed",
] as const satisfies readonly SpecRecordStatus[];

export const SPEC_AGENT_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export type SpecAgentStatus = (typeof SPEC_AGENT_STATUS_VALUES)[number];

export const specAgentStatusSchema = z.enum(SPEC_AGENT_STATUS_VALUES);

/**
 * Spec agent statuses that indicate the agent has finished execution.
 */
export const TERMINAL_SPEC_AGENT_STATUSES: readonly SpecAgentStatus[] = [
  "succeeded",
  "failed",
] as const satisfies readonly SpecAgentStatus[];
