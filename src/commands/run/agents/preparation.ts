import {
  ensureWorkspaceError,
  prepareAgentWorkspace,
} from "../../../workspace/agents.js";
import { buildAgentWorkspacePaths } from "../../../workspace/layout.js";
import { RunCommandError } from "../errors.js";
import { AgentRunContext } from "./run-context.js";
import type {
  AgentExecutionContext,
  AgentPreparationOutcome,
} from "./types.js";

export async function prepareAgentForExecution(
  context: AgentExecutionContext,
): Promise<AgentPreparationOutcome> {
  const { agent, baseRevisionSha, runId, root, prompt, evalPlan, environment } =
    context;

  const workspacePaths = buildAgentWorkspacePaths({
    root,
    runId,
    agentId: agent.id,
  });
  const startedAt = new Date().toISOString();
  const agentContext = new AgentRunContext({
    agent,
    runId,
    startedAt,
    evalPlan,
  });

  try {
    await prepareAgentWorkspace({
      paths: workspacePaths,
      baseRevisionSha,
      root,
      agentId: agent.id,
      runId,
      environment,
    });
  } catch (error) {
    return {
      status: "failed",
      result: await agentContext.failWith(ensureWorkspaceFailure(error)),
    };
  }

  return {
    status: "ready",
    prepared: {
      agent,
      agentContext,
      workspacePaths,
      baseRevisionSha,
      root,
      runId,
      prompt,
      evalPlan,
      environment,
    },
  };
}

function ensureWorkspaceFailure(error: unknown): RunCommandError {
  return error instanceof RunCommandError ? error : ensureWorkspaceError(error);
}
