import type {
  AgentInvocationRecord,
  AgentReport,
  RunRecord,
} from "../../records/types.js";

export interface RunRecordInitResult {
  readonly initialRecord: RunRecord;
  readonly recordPersisted: boolean;
}

export interface AgentExecutionPhaseResult {
  readonly agentRecords: AgentInvocationRecord[];
  readonly agentReports: AgentReport[];
  readonly hadAgentFailure: boolean;
  readonly hadEvalFailure: boolean;
}
