import { z } from "zod";

export const RUN_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "errored",
  "aborted",
  "pruned",
] as const;

export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export const runStatusSchema = z.enum(RUN_STATUS_VALUES);

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

/**
 * Agent statuses that require eval results to be present.
 * "aborted" is excluded because agents can be cancelled before evals are produced.
 */
export const EVAL_REQUIRED_AGENT_STATUSES: readonly AgentStatus[] = [
  "succeeded",
  "failed",
  "errored",
  "skipped",
] as const satisfies readonly AgentStatus[];

export const EVAL_STATUS_VALUES = [
  "succeeded",
  "failed",
  "errored",
  "skipped",
] as const;

export type EvalStatus = (typeof EVAL_STATUS_VALUES)[number];

export const evalStatusSchema = z.enum(EVAL_STATUS_VALUES);

export const APPLY_STATUS_VALUES = ["succeeded", "failed"] as const;

export type ApplyStatus = (typeof APPLY_STATUS_VALUES)[number];

export const applyStatusSchema = z.enum(APPLY_STATUS_VALUES);

export const REVIEW_STATUS_VALUES = ["running", "succeeded", "failed"] as const;

export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];

export const reviewStatusSchema = z.enum(REVIEW_STATUS_VALUES);

/**
 * Review statuses that indicate the review session has finished.
 */
export const TERMINAL_REVIEW_STATUSES: readonly ReviewStatus[] = [
  "succeeded",
  "failed",
] as const satisfies readonly ReviewStatus[];

export const SPEC_RECORD_STATUS_VALUES = [
  "drafting",
  "saving",
  "saved",
  "aborted",
  "failed",
] as const;

export type SpecRecordStatus = (typeof SPEC_RECORD_STATUS_VALUES)[number];

export const specRecordStatusSchema = z.enum(SPEC_RECORD_STATUS_VALUES);

/**
 * Spec record statuses that indicate the spec session has finished.
 */
export const TERMINAL_SPEC_STATUSES: readonly SpecRecordStatus[] = [
  "saved",
  "aborted",
  "failed",
] as const satisfies readonly SpecRecordStatus[];
