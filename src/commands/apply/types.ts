import type { AgentInvocationRecord } from "../../records/types.js";
import type { RunStatus } from "../../status/index.js";

export interface ApplyResult {
  runId: string;
  specPath: string;
  status: RunStatus;
  createdAt: string;
  baseRevisionSha: string;
  headRevision: string;
  agent: AgentInvocationRecord;
  diffPath: string;
  ignoredBaseMismatch: boolean;
}
