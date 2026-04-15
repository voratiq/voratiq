import { rename, writeFile } from "node:fs/promises";

export const VORATIQ_MCP_ACK_PATH_ENV = "VORATIQ_MCP_ACK_PATH";
export const VORATIQ_MCP_ACK_OPERATOR_ENV = "VORATIQ_MCP_ACK_OPERATOR";

export type DurableAckOperator =
  | "spec"
  | "run"
  | "reduce"
  | "verify"
  | "message";

export type DurableAckStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "unresolved";

export async function emitDurableOperatorAcknowledgement(options: {
  operator: DurableAckOperator;
  sessionId: string;
  status: DurableAckStatus;
}): Promise<void> {
  const ackPath = process.env[VORATIQ_MCP_ACK_PATH_ENV];
  const ackOperator = process.env[VORATIQ_MCP_ACK_OPERATOR_ENV];

  if (!ackPath || ackOperator !== options.operator) {
    return;
  }

  const tempPath = `${ackPath}.tmp`;
  await writeFile(
    tempPath,
    JSON.stringify({
      operator: options.operator,
      sessionId: options.sessionId,
      status: options.status,
    }),
    "utf8",
  );
  await rename(tempPath, ackPath);
}
