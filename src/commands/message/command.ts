import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { createTeardownController } from "../../competition/shared/teardown.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import {
  createMessageCompetitionAdapter,
  type MessageCompetitionExecution,
} from "../../domain/message/competition/adapter.js";
import { createMessageRecordMutators } from "../../domain/message/model/mutators.js";
import {
  deriveMessageStatusFromRecipients,
  type MessageRecipientEntry,
  type MessageRecord,
  type MessageTarget,
} from "../../domain/message/model/types.js";
import {
  appendMessageRecord,
  flushMessageRecordBuffer,
} from "../../domain/message/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import { loadOperatorEnvironment } from "../../preflight/environment.js";
import { prepareConfiguredOperatorReadiness } from "../../preflight/operator.js";
import type { MessageProgressRenderer } from "../../render/transcripts/message.js";
import { emitDurableOperatorAcknowledgement } from "../../utils/durable-ack.js";
import { toErrorMessage } from "../../utils/errors.js";
import { getHeadRevision } from "../../utils/git.js";
import {
  VORATIQ_MESSAGE_DIR,
  VORATIQ_REDUCTION_DIR,
  VORATIQ_RUN_DIR,
  VORATIQ_SPEC_DIR,
  VORATIQ_VERIFICATION_DIR,
} from "../../workspace/structure.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  MessageAgentNotFoundError,
  MessageGenerationFailedError,
  MessageInvocationContextError,
  MessagePreflightError,
} from "./errors.js";
import { finalizeActiveMessage, registerActiveMessage } from "./lifecycle.js";

export interface ExecuteMessageCommandInput {
  root: string;
  messagesFilePath: string;
  prompt: string;
  agentIds?: readonly string[];
  agentOverrideFlag?: string;
  profileName?: string;
  maxParallel?: number;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
  target?: MessageTarget;
  sourceInteractiveSessionId?: string;
  renderer?: MessageProgressRenderer;
}

export interface ExecuteMessageCommandResult {
  messageId: string;
  record: MessageRecord;
  recipients: readonly MessageRecipientEntry[];
  executions: readonly MessageCompetitionExecution[];
}

export async function executeMessageCommand(
  input: ExecuteMessageCommandInput,
): Promise<ExecuteMessageCommandResult> {
  assertMessageInvocationContext();

  const {
    root,
    messagesFilePath,
    prompt,
    agentIds,
    agentOverrideFlag,
    profileName,
    maxParallel: requestedMaxParallel,
    extraContextFiles = [],
    target,
    sourceInteractiveSessionId,
    renderer,
  } = input;

  let resolvedAgentIds: readonly string[];
  try {
    const resolution = resolveStageCompetitors({
      root,
      stageId: "message",
      cliAgentIds: agentIds,
      cliOverrideFlag: agentOverrideFlag,
      profileName,
      includeDefinitions: false,
    });
    resolvedAgentIds = resolution.agentIds;
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new MessageAgentNotFoundError(error.agentId);
    }
    throw error;
  }

  const preflight = await prepareConfiguredOperatorReadiness({
    root,
    resolvedAgentIds,
    includeEnvironment: false,
  });
  if (preflight.issues.length > 0) {
    throw new MessagePreflightError(
      preflight.issues,
      preflight.preProviderIssueCount,
    );
  }
  const competitors = preflight.agents;
  const environment = loadOperatorEnvironment({ root });
  const baseRevisionSha = await getHeadRevision(root);
  const messageId = generateSessionId();
  const createdAt = new Date().toISOString();
  const startedAt = createdAt;
  const persistedTarget = resolveMessageTarget({
    target,
    sourceInteractiveSessionId,
  });
  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: competitors.length,
    requestedMaxParallel,
  });

  const initialRecipients: MessageRecipientEntry[] = competitors.map(
    (agent) => ({
      agentId: agent.id,
      status: "queued",
    }),
  );

  await appendMessageRecord({
    root,
    messagesFilePath,
    record: {
      sessionId: messageId,
      createdAt,
      startedAt,
      status: "running",
      baseRevisionSha,
      prompt,
      recipients: initialRecipients,
      ...buildPersistedExtraContextFields(extraContextFiles),
      ...(persistedTarget ? { target: persistedTarget } : {}),
      ...(sourceInteractiveSessionId ? { sourceInteractiveSessionId } : {}),
    },
  });
  await emitDurableOperatorAcknowledgement({
    operator: "message",
    sessionId: messageId,
    status: "running",
  });

  renderer?.begin({
    messageId,
    createdAt,
    startedAt,
    workspacePath: `.voratiq/message/sessions/${messageId}`,
    status: "running",
  });

  const teardown = createTeardownController(`message \`${messageId}\``);
  registerActiveMessage({
    root,
    messagesFilePath,
    messageId,
    teardown,
  });

  const mutators = createMessageRecordMutators({
    root,
    messagesFilePath,
    messageId,
  });

  let executions: MessageCompetitionExecution[];
  try {
    const baseAdapter = createMessageCompetitionAdapter({
      root,
      messageId,
      prompt,
      environment,
      extraContextFiles,
      teardown,
    });

    executions = await executeCompetitionWithAdapter({
      candidates: [...competitors],
      maxParallel: effectiveMaxParallel,
      adapter: {
        ...baseAdapter,
        onPreparationFailure: async (result) => {
          const recipient = toRecipientEntry(result);
          await mutators.recordRecipientSnapshot(recipient);
          renderer?.update(recipient);
        },
        onCandidateRunning: async (prepared) => {
          const runningAt = new Date().toISOString();
          const recipient: MessageRecipientEntry = {
            agentId: prepared.candidate.id,
            status: "running",
            startedAt: runningAt,
          };
          await mutators.recordRecipientRunning(recipient);
          renderer?.update(recipient);
        },
        onCandidateCompleted: async (_prepared, result) => {
          const recipient = toRecipientEntry(result);
          await mutators.recordRecipientSnapshot(recipient);
          renderer?.update(recipient);
        },
      },
    });
    const persistedRecord = await mutators.readRecord();
    if (!persistedRecord) {
      throw new MessageGenerationFailedError([
        `Message session \`${messageId}\` record not found after execution.`,
      ]);
    }

    const status = deriveMessageStatusFromRecipients(
      persistedRecord.recipients.map((recipient) => recipient.status),
    );
    const completedRecord = await mutators.completeMessage({
      status,
      error:
        status === "failed"
          ? collectRecipientErrors(persistedRecord.recipients)
          : undefined,
    });

    await flushMessageRecordBuffer({
      messagesFilePath,
      sessionId: messageId,
    });
    renderer?.complete(completedRecord.status, {
      startedAt: completedRecord.startedAt,
      completedAt: completedRecord.completedAt,
    });

    return {
      messageId,
      record: completedRecord,
      recipients: completedRecord.recipients,
      executions,
    };
  } catch (error) {
    await mutators
      .completeMessage({
        status: "failed",
        error: toErrorMessage(error),
      })
      .then((failedRecord) => {
        renderer?.complete(failedRecord.status, {
          startedAt: failedRecord.startedAt,
          completedAt: failedRecord.completedAt,
        });
      })
      .catch(() => {
        renderer?.complete("failed");
      });
    await flushMessageRecordBuffer({
      messagesFilePath,
      sessionId: messageId,
    }).catch(() => {});
    throw new MessageGenerationFailedError([toErrorMessage(error)]);
  } finally {
    await finalizeActiveMessage(messageId);
  }
}

function toRecipientEntry(
  execution: MessageCompetitionExecution,
): MessageRecipientEntry {
  return {
    agentId: execution.agentId,
    status: execution.status,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    outputPath: execution.outputPath,
    stdoutPath: execution.stdoutPath,
    stderrPath: execution.stderrPath,
    tokenUsage: execution.tokenUsage,
    error: execution.error ?? null,
  };
}

function assertMessageInvocationContext(): void {
  const cwd = process.cwd().replace(/\\/gu, "/");
  const batchDomains = [
    VORATIQ_SPEC_DIR,
    VORATIQ_RUN_DIR,
    VORATIQ_REDUCTION_DIR,
    VORATIQ_VERIFICATION_DIR,
    VORATIQ_MESSAGE_DIR,
  ];
  const batchWorkspacePattern = new RegExp(
    `/\\.voratiq/(?:${batchDomains.join("|")})/sessions/[^/]+/[^/]+/workspace(?:/|$)`,
    "u",
  );

  if (batchWorkspacePattern.test(cwd)) {
    throw new MessageInvocationContextError();
  }
}

function collectRecipientErrors(
  recipients: readonly MessageRecipientEntry[],
): string | undefined {
  const details = recipients
    .filter((recipient) => recipient.error)
    .map((recipient) => `${recipient.agentId}: ${recipient.error}`);
  return details.length > 0 ? details.join("; ") : undefined;
}

function resolveMessageTarget(options: {
  target?: MessageTarget;
  sourceInteractiveSessionId?: string;
}): MessageTarget | undefined {
  const { target, sourceInteractiveSessionId } = options;
  if (target) {
    return target;
  }

  if (sourceInteractiveSessionId) {
    return {
      kind: "interactive",
      sessionId: sourceInteractiveSessionId,
    };
  }

  return undefined;
}
