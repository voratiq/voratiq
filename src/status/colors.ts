import type { EvalStatus } from "../configs/evals/types.js";
import type { TerminalColor } from "../utils/colors.js";
import type { AgentStatus, RunStatus } from "./index.js";

interface StatusStyle {
  cli: TerminalColor;
}

const agentStatusStyles: Record<AgentStatus, StatusStyle> = {
  succeeded: { cli: "green" },
  failed: { cli: "red" },
  errored: { cli: "red" },
  skipped: { cli: "yellow" },
  aborted: { cli: "yellow" },
  running: { cli: "cyan" },
  queued: { cli: "gray" },
};

const evalStatusStyles: Record<EvalStatus, StatusStyle> = {
  succeeded: { cli: "green" },
  failed: { cli: "red" },
  errored: { cli: "red" },
  skipped: { cli: "gray" },
};

const runStatusStyles: Record<RunStatus, StatusStyle> = {
  succeeded: { cli: "green" },
  failed: { cli: "red" },
  errored: { cli: "red" },
  aborted: { cli: "yellow" },
  pruned: { cli: "gray" },
  running: { cli: "cyan" },
  queued: { cli: "gray" },
};

export function getAgentStatusStyle(status: AgentStatus): StatusStyle {
  return agentStatusStyles[status];
}

export function getEvalStatusStyle(status: EvalStatus): StatusStyle {
  return evalStatusStyles[status];
}

export function getRunStatusStyle(status: RunStatus): StatusStyle {
  return runStatusStyles[status];
}
