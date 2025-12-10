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

export const EVAL_STATUS_VALUES = [
  "succeeded",
  "failed",
  "errored",
  "skipped",
] as const;

export type EvalStatus = (typeof EVAL_STATUS_VALUES)[number];

export const APPLY_STATUS_VALUES = ["succeeded", "failed"] as const;

export type ApplyStatus = (typeof APPLY_STATUS_VALUES)[number];

export const runStatusSchema = z.enum(RUN_STATUS_VALUES);
export const agentStatusSchema = z.enum(AGENT_STATUS_VALUES);
export const evalStatusSchema = z.enum(EVAL_STATUS_VALUES);
export const applyStatusEnum = z.enum(APPLY_STATUS_VALUES);
