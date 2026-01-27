import { ensureWorkspaceError } from "../../../workspace/agents.js";
import { RunCommandError } from "../errors.js";
import { buildRunPrompt } from "../prompt.js";
import { AgentRunContext } from "./run-context.js";
import type {
  AgentExecutionContext,
  AgentPreparationOutcome,
} from "./types.js";
import type { RunAgentWorkspacePaths } from "./workspace.js";
import { buildRunAgentWorkspace } from "./workspace.js";

export async function prepareAgentForExecution(
  context: AgentExecutionContext,
): Promise<AgentPreparationOutcome> {
  const {
    agent,
    baseRevisionSha,
    runId,
    root,
    specContent,
    evalPlan,
    environment,
  } = context;

  const startedAt = new Date().toISOString();
  const agentContext = new AgentRunContext({
    agent,
    runId,
    startedAt,
    evalPlan,
  });

  let workspacePaths: RunAgentWorkspacePaths;
  try {
    workspacePaths = await buildRunAgentWorkspace({
      root,
      runId,
      agentId: agent.id,
      baseRevisionSha,
      environment,
    });
  } catch (error) {
    return {
      status: "failed",
      result: await agentContext.failWith(ensureWorkspaceFailure(error)),
    };
  }

  const prompt = buildRunPrompt({
    specContent,
    workspacePath: workspacePaths.workspacePath,
  });

  return {
    status: "ready",
    prepared: {
      agent,
      agentContext,
      workspacePaths: workspacePaths,
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
