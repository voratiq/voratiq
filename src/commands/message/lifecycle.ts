import type { TeardownController } from "../../competition/shared/teardown.js";
import { runTeardown } from "../../competition/shared/teardown.js";
import type { MessageRecipientEntry } from "../../domain/message/model/types.js";
import {
  flushMessageRecordBuffer,
  readMessageRecords,
  rewriteMessageRecord,
} from "../../domain/message/persistence/adapter.js";
import {
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
} from "../../domain/shared/lifecycle.js";
import { toErrorMessage } from "../../utils/errors.js";

export const MESSAGE_ABORT_DETAIL =
  "Message generation aborted before completion.";
export const MESSAGE_FAILURE_DETAIL = "Message generation failed.";

interface ActiveMessageContext {
  root: string;
  messagesFilePath: string;
  messageId: string;
  teardown?: TeardownController;
}

let activeMessage: ActiveMessageContext | undefined;
let terminationInFlight = false;

export function registerActiveMessage(context: ActiveMessageContext): void {
  activeMessage = context;
}

export function clearActiveMessage(messageId: string): void {
  if (activeMessage?.messageId !== messageId) {
    return;
  }

  if (!terminationInFlight) {
    activeMessage = undefined;
  }
}

export async function terminateActiveMessage(
  status: "failed" | "aborted",
): Promise<void> {
  if (!activeMessage || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeMessage;
  let persistenceError: Error | undefined;

  try {
    const existingRecord = await readMessageRecords({
      root: context.root,
      messagesFilePath: context.messagesFilePath,
      limit: 1,
      predicate: (record) => record.sessionId === context.messageId,
    }).then((records) => records[0]);

    if (!existingRecord) {
      return;
    }

    const completedAt = new Date().toISOString();
    const detail =
      status === "aborted" ? MESSAGE_ABORT_DETAIL : MESSAGE_FAILURE_DETAIL;

    await rewriteMessageRecord({
      root: context.root,
      messagesFilePath: context.messagesFilePath,
      sessionId: context.messageId,
      mutate: (existing) => {
        const recipients = existing.recipients.map((recipient) =>
          finalizeMessageRecipient({
            recipient,
            status,
            completedAt,
            detail,
          }),
        );

        const inProgress =
          existing.status === "queued" || existing.status === "running";
        if (!inProgress) {
          if (
            recipients.every(
              (recipient, index) => recipient === existing.recipients[index],
            )
          ) {
            return existing;
          }

          return {
            ...existing,
            recipients,
          };
        }

        return {
          ...existing,
          status,
          recipients,
          ...buildRecordLifecycleCompleteFields({
            existing,
            startedAt: existing.startedAt ?? completedAt,
            completedAt,
          }),
          error: existing.error ?? detail,
        };
      },
      forceFlush: true,
    });

    await flushMessageRecordBuffer({
      messagesFilePath: context.messagesFilePath,
      sessionId: context.messageId,
    });
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to finalize message ${context.messageId}: ${toErrorMessage(error)}`,
    );
  } finally {
    try {
      await finalizeRegisteredMessageTeardown(context);
    } finally {
      terminationInFlight = false;
      activeMessage = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

export async function finalizeActiveMessage(messageId: string): Promise<void> {
  if (!activeMessage || activeMessage.messageId !== messageId) {
    clearActiveMessage(messageId);
    return;
  }

  const context = activeMessage;
  try {
    await finalizeRegisteredMessageTeardown(context);
  } finally {
    clearActiveMessage(messageId);
  }
}

function finalizeMessageRecipient(options: {
  recipient: MessageRecipientEntry;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): MessageRecipientEntry {
  const { recipient, status, completedAt, detail } = options;

  if (recipient.status !== "queued" && recipient.status !== "running") {
    return recipient;
  }

  return {
    ...recipient,
    status,
    ...buildOperationLifecycleCompleteFields({
      existing: recipient,
      startedAt: recipient.startedAt ?? completedAt,
      completedAt,
    }),
    error: recipient.error ?? detail,
  };
}

async function finalizeRegisteredMessageTeardown(
  context: ActiveMessageContext,
): Promise<void> {
  await runTeardown(context.teardown);
}
