import {
  ensureWorkspaceError,
  prepareAgentWorkspace,
} from "../../../workspace/agents.js";
import { buildAgentWorkspacePaths } from "../../../workspace/layout.js";
import { MissingAgentProviderError, RunCommandError } from "../errors.js";
import {
  registerStagedSandboxContext,
  teardownRegisteredSandboxContext,
} from "../sandbox-registry.js";
import { stageAgentAuth, type StagedAuthContext } from "./auth-stage.js";
import { captureAgentChatTranscripts } from "./chat-preserver.js";
import { AgentRunContext } from "./run-context.js";
import { configureSandboxSettings } from "./sandbox-launcher.js";
import type {
  AgentExecutionContext,
  AgentPreparationOutcome,
} from "./types.js";
import { writeAgentManifest } from "./workspace-prep.js";

export async function prepareAgentForExecution(
  context: AgentExecutionContext,
): Promise<AgentPreparationOutcome> {
  const { agent, baseRevisionSha, runId, root, evalPlan, environment } =
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

  let authContext: StagedAuthContext | undefined;
  let manifestEnv: Record<string, string> = {};

  try {
    const staged = await stageAgentAuth({
      agent,
      agentRoot: workspacePaths.agentRoot,
      runId,
      root,
    });
    authContext = staged.context;
    registerStagedSandboxContext(authContext);
    manifestEnv = staged.env;
  } catch (error) {
    return {
      status: "failed",
      result: await agentContext.failWith(ensureWorkspaceFailure(error)),
    };
  }

  try {
    manifestEnv = await writeAgentManifest({
      agent,
      workspacePaths,
      env: manifestEnv,
      environment,
    });
  } catch (error) {
    await captureAgentChatTranscripts({
      agent,
      agentContext,
      agentRoot: workspacePaths.agentRoot,
      reason: "pre-run",
    });
    await teardownRegisteredSandboxContext(authContext);
    return {
      status: "failed",
      result: await agentContext.failWith(ensureWorkspaceFailure(error)),
    };
  }

  try {
    const providerId = agent.provider;
    if (!providerId) {
      throw new MissingAgentProviderError(agent.id);
    }
    await configureSandboxSettings({
      workspacePaths,
      providerId,
      root,
    });
  } catch (error) {
    await captureAgentChatTranscripts({
      agent,
      agentContext,
      agentRoot: workspacePaths.agentRoot,
      reason: "pre-run",
    });
    await teardownRegisteredSandboxContext(authContext);
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
      runtimeManifestPath: workspacePaths.runtimeManifestPath,
      baseRevisionSha,
      root,
      runId,
      evalPlan,
      environment,
      manifestEnv,
      authContext,
    },
  };
}

function ensureWorkspaceFailure(error: unknown): RunCommandError {
  return error instanceof RunCommandError ? error : ensureWorkspaceError(error);
}
