import {
  buildLifecycleStartFields,
  buildRecordLifecycleCompleteFields,
} from "../../shared/lifecycle.js";
import { rewriteMessageRecord } from "../persistence/adapter.js";
import type {
  MessageRecipientEntry,
  MessageRecord,
  MessageStatus,
} from "./types.js";

export interface MessageRecordMutators {
  recordRecipientQueued: (recipient: MessageRecipientEntry) => Promise<void>;
  recordRecipientRunning: (recipient: MessageRecipientEntry) => Promise<void>;
  recordRecipientSnapshot: (recipient: MessageRecipientEntry) => Promise<void>;
  completeMessage: (options: {
    status: MessageStatus;
    error?: string | null;
  }) => Promise<MessageRecord>;
  readRecord: () => Promise<MessageRecord | undefined>;
}

export interface CreateMessageRecordMutatorsInput {
  readonly root: string;
  readonly messagesFilePath: string;
  readonly messageId: string;
}

export function createMessageRecordMutators(
  input: CreateMessageRecordMutatorsInput,
): MessageRecordMutators {
  const { root, messagesFilePath, messageId } = input;

  return {
    recordRecipientQueued: async (recipient) => {
      await updateRecipient({
        root,
        messagesFilePath,
        messageId,
        recipient,
      });
    },
    recordRecipientRunning: async (recipient) => {
      await updateRecipient({
        root,
        messagesFilePath,
        messageId,
        recipient,
      });
    },
    recordRecipientSnapshot: async (recipient) => {
      await updateRecipient({
        root,
        messagesFilePath,
        messageId,
        recipient,
        forceFlush:
          recipient.status === "succeeded" ||
          recipient.status === "failed" ||
          recipient.status === "aborted",
      });
    },
    completeMessage: async ({ status, error }) =>
      await rewriteMessageRecord({
        root,
        messagesFilePath,
        sessionId: messageId,
        mutate: (existing) => {
          if (existing.status !== "queued" && existing.status !== "running") {
            return existing;
          }

          return {
            ...existing,
            status,
            ...buildRecordLifecycleCompleteFields({ existing }),
            ...(error !== undefined ? { error } : {}),
          };
        },
        forceFlush: true,
      }),
    readRecord: async () =>
      await rewriteMessageRecord({
        root,
        messagesFilePath,
        sessionId: messageId,
        mutate: (record) => record,
      }),
  };
}

async function updateRecipient(options: {
  root: string;
  messagesFilePath: string;
  messageId: string;
  recipient: MessageRecipientEntry;
  forceFlush?: boolean;
}): Promise<void> {
  const {
    root,
    messagesFilePath,
    messageId,
    recipient,
    forceFlush = false,
  } = options;

  await rewriteMessageRecord({
    root,
    messagesFilePath,
    sessionId: messageId,
    forceFlush,
    mutate: (existing) => {
      const recipients = [...existing.recipients];
      const index = recipients.findIndex(
        (entry) => entry.agentId === recipient.agentId,
      );
      const current = index >= 0 ? recipients[index] : undefined;
      const merged = mergeRecipientEntries(current, recipient);
      if (index >= 0) {
        recipients[index] = merged;
      } else {
        recipients.push(merged);
      }

      return {
        ...existing,
        status:
          existing.status === "running" || merged.status !== "running"
            ? existing.status
            : "running",
        ...(merged.startedAt
          ? buildLifecycleStartFields({
              existingStartedAt: existing.startedAt,
              timestamp: merged.startedAt,
            })
          : {}),
        recipients,
      };
    },
  });
}

function mergeRecipientEntries(
  existing: MessageRecipientEntry | undefined,
  incoming: MessageRecipientEntry,
): MessageRecipientEntry {
  if (
    existing &&
    isTerminalRecipientStatus(existing.status) &&
    !isTerminalRecipientStatus(incoming.status)
  ) {
    return existing;
  }

  return {
    ...(existing ?? {}),
    ...incoming,
    outputPath: incoming.outputPath ?? existing?.outputPath,
    stdoutPath: incoming.stdoutPath ?? existing?.stdoutPath,
    stderrPath: incoming.stderrPath ?? existing?.stderrPath,
    tokenUsage: incoming.tokenUsage ?? existing?.tokenUsage,
    error:
      incoming.error !== undefined ? incoming.error : (existing?.error ?? null),
    startedAt: incoming.startedAt ?? existing?.startedAt,
    completedAt: incoming.completedAt ?? existing?.completedAt,
  };
}

function isTerminalRecipientStatus(
  status: MessageRecipientEntry["status"],
): boolean {
  return status === "succeeded" || status === "failed" || status === "aborted";
}
