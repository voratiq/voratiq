import type {
  AgentInvocationRecord,
  WatchdogMetadata,
} from "../../../records/types.js";
import { toErrorMessage } from "../../../utils/errors.js";
import { GIT_AUTHOR_EMAIL, GIT_AUTHOR_NAME } from "../../../utils/git.js";
import {
  AgentProcessError,
  GitOperationError,
  RunCommandError,
} from "../errors.js";
import type { AgentExecutionResult } from "../reports.js";
import { teardownRegisteredSandboxContext } from "../sandbox-registry.js";
import { captureAgentChatTranscripts } from "./chat-preserver.js";
import { runPostProcessingAndEvaluations } from "./eval-runner.js";
import { detectAgentProcessFailureDetail } from "./failures.js";
import { AgentRunContext } from "./run-context.js";
import { runAgentProcess } from "./sandbox-launcher.js";
import type { PreparedAgentExecution } from "./types.js";
import { WATCHDOG_DEFAULTS, type WatchdogTrigger } from "./watchdog.js";

export async function runPreparedAgent(
  execution: PreparedAgentExecution,
): Promise<AgentExecutionResult> {
  try {
    return await executeAgentLifecycle(execution);
  } finally {
    await teardownRegisteredSandboxContext(execution.authContext);
  }
}

export async function executeAgentLifecycle(
  execution: PreparedAgentExecution,
): Promise<AgentExecutionResult> {
  const {
    agentContext,
    agent,
    workspacePaths,
    baseRevisionSha,
    root,
    evalPlan,
    runtimeManifestPath,
    environment,
    manifestEnv,
  } = execution;

  // Set initial watchdog metadata (will be updated with trigger if fired)
  const initialWatchdog: WatchdogMetadata = {
    silenceTimeoutMs: WATCHDOG_DEFAULTS.silenceTimeoutMs,
    wallClockCapMs: WATCHDOG_DEFAULTS.wallClockCapMs,
  };
  agentContext.setWatchdogMetadata(initialWatchdog);

  try {
    agentContext.markStarted();
    if (execution.progress?.onRunning) {
      await execution.progress.onRunning(
        buildRunningAgentRecord(execution, agentContext),
      );
    }

    // Create watchdog trigger callback for immediate UI surfacing
    const onWatchdogTrigger = (
      trigger: WatchdogTrigger,
      reason: string,
    ): void => {
      // Update watchdog metadata with trigger
      agentContext.setWatchdogMetadata({
        ...initialWatchdog,
        trigger,
      });

      // Fire early failure callback for immediate UI update
      if (execution.progress?.onEarlyFailure) {
        const earlyRecord = agentContext.buildEarlyFailureRecord(reason);
        void execution.progress.onEarlyFailure(earlyRecord);
      }
    };

    const processResult = await runAgentProcess({
      runtimeManifestPath,
      agentRoot: workspacePaths.agentRoot,
      stdoutPath: workspacePaths.stdoutPath,
      stderrPath: workspacePaths.stderrPath,
      sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
      providerId: agent.provider,
      onWatchdogTrigger,
    });

    // Update watchdog metadata from process result (in case trigger came via watchdog)
    if (processResult.watchdog) {
      agentContext.setWatchdogMetadata(processResult.watchdog);
    }

    if (processResult.exitCode !== 0 || processResult.errorMessage) {
      // Use watchdog error message if available, otherwise detect from logs
      const failureDetail =
        processResult.watchdog?.trigger && processResult.errorMessage
          ? processResult.errorMessage
          : await detectAgentProcessFailureDetail({
              agentId: agent.id,
              provider: agent.provider,
              stdoutPath: workspacePaths.stdoutPath,
              stderrPath: workspacePaths.stderrPath,
            });

      const failure = new AgentProcessError({
        exitCode: processResult.exitCode,
        detail: failureDetail,
      });
      agentContext.markFailure(failure);
    }
  } catch (rawError) {
    const failure =
      rawError instanceof RunCommandError
        ? rawError
        : new AgentProcessError({
            detail: toErrorMessage(rawError),
          });
    agentContext.markFailure(failure);
  }

  await captureAgentChatTranscripts({
    agent,
    agentContext,
    agentRoot: workspacePaths.agentRoot,
    reason: "post-run",
  });

  if (agentContext.isFailed()) {
    agentContext.setCompleted();
    return finalizeExecution(execution, () => agentContext.finalize());
  }

  try {
    const postProcessResult = await runPostProcessingAndEvaluations({
      evalPlan,
      workspacePaths,
      baseRevisionSha,
      root,
      manifestEnv,
      environment,
      persona: resolveSandboxPersona(manifestEnv),
    });

    agentContext.applyArtifacts(postProcessResult.artifacts);
    if (postProcessResult.warnings.length > 0) {
      for (const warning of postProcessResult.warnings) {
        console.warn(`[voratiq] ${warning}`);
      }
      agentContext.recordEvalWarnings(postProcessResult.warnings);
    }
    agentContext.applyEvaluations(postProcessResult.evaluations);
  } catch (rawError) {
    const failure = classifyPostProcessError(rawError);
    return finalizeExecution(execution, async () =>
      agentContext.failWith(failure),
    );
  }

  agentContext.setCompleted();
  return finalizeExecution(execution, () => agentContext.finalize());
}

export function buildRunningAgentRecord(
  execution: PreparedAgentExecution,
  agentContext: AgentRunContext,
): AgentInvocationRecord {
  const { agent } = execution;
  return {
    agentId: agent.id,
    model: agent.model,
    status: "running",
    startedAt: agentContext.getStartedAt(),
    artifacts: {
      diffAttempted: false,
      diffCaptured: false,
      stdoutCaptured: true,
      stderrCaptured: true,
    },
  } satisfies AgentInvocationRecord;
}

export function classifyPostProcessError(error: unknown): RunCommandError {
  if (error instanceof RunCommandError) {
    return error;
  }
  const detail = toErrorMessage(error);
  return new GitOperationError({
    operation: "Run finalization failed",
    detail,
  });
}

async function finalizeExecution(
  execution: PreparedAgentExecution,
  finalize: () => AgentExecutionResult | Promise<AgentExecutionResult>,
): Promise<AgentExecutionResult> {
  const result = await finalize();
  if (execution.progress?.onCompleted) {
    await execution.progress.onCompleted(result);
  }
  return result;
}

function resolveSandboxPersona(env: Record<string, string>): {
  authorName: string;
  authorEmail: string;
} {
  // The sandbox shim injects these Git persona env vars before spawning agent binaries.
  // Keep this helper synchronized with src/commands/run/shim/run-agent-shim.ts.
  return {
    authorName: env["GIT_AUTHOR_NAME"] ?? GIT_AUTHOR_NAME,
    authorEmail: env["GIT_AUTHOR_EMAIL"] ?? GIT_AUTHOR_EMAIL,
  };
}
