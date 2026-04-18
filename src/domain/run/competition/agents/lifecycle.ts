import { detectAgentProcessFailureDetail } from "../../../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../../../agents/runtime/harness.js";
import type { SandboxFailFastInfo } from "../../../../agents/runtime/sandbox.js";
import {
  WATCHDOG_DEFAULTS,
  type WatchdogTrigger,
} from "../../../../agents/runtime/watchdog.js";
import { composeStageSandboxPolicy } from "../../../../competition/shared/sandbox-policy.js";
import {
  AgentProcessError,
  GitOperationError,
  RunCommandError,
} from "../../../../domain/run/competition/errors.js";
import type { AgentExecutionResult } from "../../../../domain/run/competition/reports.js";
import type {
  AgentInvocationRecord,
  WatchdogMetadata,
} from "../../../../domain/run/model/types.js";
import { toErrorMessage } from "../../../../utils/errors.js";
import { GIT_AUTHOR_EMAIL, GIT_AUTHOR_NAME } from "../../../../utils/git.js";
import { extractProviderNativeTokenUsageForSession } from "../../../../workspace/chat/native-usage.js";
import { VORATIQ_RUN_DIR } from "../../../../workspace/constants.js";
import { runPostProcessingAndCollectArtifacts } from "./post-processing.js";
import { AgentRunContext } from "./run-context.js";
import type { PreparedAgentExecution } from "./types.js";

export async function runPreparedAgent(
  execution: PreparedAgentExecution,
): Promise<AgentExecutionResult> {
  return await executeAgentLifecycle(execution);
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
    prompt,
    hasStagedContext,
    environment,
  } = execution;
  let manifestEnv: Record<string, string> = {};

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
      failFast?: SandboxFailFastInfo,
    ): void => {
      // Update watchdog metadata with trigger
      agentContext.setWatchdogMetadata({
        ...initialWatchdog,
        trigger,
      });

      if (failFast) {
        agentContext.setFailFastTriggered(failFast);
      }

      // Fire early failure callback for immediate UI update
      if (execution.progress?.onEarlyFailure) {
        const earlyRecord = agentContext.buildEarlyFailureRecord(reason);
        void execution.progress.onEarlyFailure(earlyRecord);
      }
    };

    const sandboxPolicy = await composeStageSandboxPolicy({
      stageId: "run",
      root,
      workspacePath: workspacePaths.workspacePath,
      runtimePath: workspacePaths.runtimePath,
      sandboxHomePath: workspacePaths.sandboxHomePath,
      environment,
      contextPath: workspacePaths.contextPath,
      includeStagedContext: hasStagedContext,
    });

    const processResult = await runSandboxedAgent({
      root,
      sessionId: execution.runId,
      sandboxStageId: "run",
      agent,
      prompt,
      environment,
      paths: {
        agentRoot: workspacePaths.agentRoot,
        workspacePath: workspacePaths.workspacePath,
        sandboxHomePath: workspacePaths.sandboxHomePath,
        runtimeManifestPath: workspacePaths.runtimeManifestPath,
        sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
        runtimePath: workspacePaths.runtimePath,
        artifactsPath: workspacePaths.artifactsPath,
        stdoutPath: workspacePaths.stdoutPath,
        stderrPath: workspacePaths.stderrPath,
      },
      captureChat: true,
      teardownAuthOnExit: false,
      ...sandboxPolicy,
      onWatchdogTrigger,
    });

    manifestEnv = processResult.manifestEnv;

    // Update watchdog metadata from process result (in case trigger came via watchdog)
    if (processResult.watchdog) {
      agentContext.setWatchdogMetadata(processResult.watchdog);
    }
    if (processResult.failFast) {
      agentContext.setFailFastTriggered(processResult.failFast);
    }

    if (processResult.exitCode !== 0 || processResult.errorMessage) {
      const watchdogTrigger = processResult.watchdog?.trigger;
      const extractedDetail = await detectAgentProcessFailureDetail({
        provider: agent.provider,
        stdoutPath: workspacePaths.stdoutPath,
        stderrPath: workspacePaths.stderrPath,
      });
      const fallbackError =
        processResult.errorMessage &&
        isGenericProcessFailure(processResult.errorMessage)
          ? undefined
          : processResult.errorMessage;
      const failureDetail =
        watchdogTrigger === "fatal-pattern"
          ? (extractedDetail ?? fallbackError)
          : (fallbackError ?? extractedDetail);

      const failure = new AgentProcessError({
        exitCode: processResult.exitCode,
        detail: failureDetail,
      });
      agentContext.markFailure(failure);
    }

    if (processResult.chat?.captured && processResult.chat.format) {
      agentContext.markChatArtifact(processResult.chat.format);
      await tryExtractProviderNativeTokenUsage({
        execution,
        artifactPath: processResult.chat.artifactPath,
        format: processResult.chat.format,
      });
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

  if (agentContext.isFailed()) {
    agentContext.setCompleted();
    return finalizeExecution(execution, () => agentContext.finalize());
  }

  try {
    const artifacts = await runPostProcessingAndCollectArtifacts({
      workspacePaths,
      baseRevisionSha,
      root,
      environment,
      persona: resolveSandboxPersona(manifestEnv),
    });

    agentContext.applyArtifacts(artifacts);
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

function isGenericProcessFailure(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.startsWith("Agent exited with code ")) {
    return true;
  }
  if (trimmed.startsWith("Agent terminated by signal ")) {
    return true;
  }
  return false;
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

async function tryExtractProviderNativeTokenUsage(options: {
  execution: PreparedAgentExecution;
  artifactPath?: string;
  format: "json" | "jsonl";
}): Promise<void> {
  const { execution, artifactPath, format } = options;
  const { agent, root, runId, agentContext } = execution;
  const extracted = await extractProviderNativeTokenUsageForSession({
    root,
    domain: VORATIQ_RUN_DIR,
    sessionId: runId,
    agentId: agent.id,
    provider: agent.provider,
    modelId: agent.model,
    chatCaptured: true,
    format,
    artifactPath,
  });
  agentContext.setTokenUsageResult(extracted);
}
