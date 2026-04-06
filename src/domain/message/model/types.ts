import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import { extractedTokenUsageSchema } from "../../../domain/run/model/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  type MessageRecipientStatus,
  messageRecipientStatusSchema,
  type MessageStatus,
  messageStatusSchema,
  TERMINAL_MESSAGE_RECIPIENT_STATUSES,
  TERMINAL_MESSAGE_STATUSES,
} from "../../../status/index.js";
import {
  validateOperationLifecycleTimestamps,
  validateRecordLifecycleTimestamps,
} from "../../shared/lifecycle.js";

export type { MessageRecipientStatus, MessageStatus };
export {
  messageRecipientStatusSchema,
  messageStatusSchema,
  TERMINAL_MESSAGE_RECIPIENT_STATUSES,
  TERMINAL_MESSAGE_STATUSES,
};

const RUNNING_MESSAGE_RECORD_STATUSES = [
  "running",
] as const satisfies readonly MessageStatus[];

export const messageRecipientEntrySchema = z
  .object({
    agentId: agentIdSchema,
    status: messageRecipientStatusSchema,
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    outputPath: repoRelativeRecordPathSchema.optional(),
    stdoutPath: repoRelativeRecordPathSchema.optional(),
    stderrPath: repoRelativeRecordPathSchema.optional(),
    tokenUsage: extractedTokenUsageSchema.optional(),
    error: z.string().nullable().optional(),
  })
  .superRefine((recipient, ctx) => {
    if (recipient.status === "succeeded" && !recipient.outputPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputPath"],
        message: "succeeded message recipients must persist `outputPath`",
      });
    }

    validateOperationLifecycleTimestamps(
      {
        status: recipient.status,
        startedAt: recipient.startedAt,
        completedAt: recipient.completedAt,
      },
      ctx,
      {
        queued: ["queued"],
        running: ["running"],
        terminal: TERMINAL_MESSAGE_RECIPIENT_STATUSES,
      },
    );
  });

export type MessageRecipientEntry = z.infer<typeof messageRecipientEntrySchema>;

export const messageRecordSchema = z
  .object({
    sessionId: z.string(),
    createdAt: z.string(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    status: messageStatusSchema,
    baseRevisionSha: z.string().optional(),
    prompt: z.string(),
    sourceInteractiveSessionId: z.string().optional(),
    extraContext: z.array(persistedExtraContextPathSchema).optional(),
    extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
    recipients: z
      .array(messageRecipientEntrySchema)
      .min(1)
      .superRefine((recipients, ctx) => {
        const seen = new Set<string>();
        for (const recipient of recipients) {
          if (seen.has(recipient.agentId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate message recipient agent id: ${recipient.agentId}`,
            });
            return;
          }
          seen.add(recipient.agentId);
        }
      }),
    error: z.string().nullable().optional(),
  })
  .superRefine((record, ctx) => {
    validateRecordLifecycleTimestamps(
      {
        status: record.status,
        createdAt: record.createdAt,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
      ctx,
      {
        queued: [],
        running: RUNNING_MESSAGE_RECORD_STATUSES,
        terminal: TERMINAL_MESSAGE_STATUSES,
      },
    );
  });

export type MessageRecord = z.infer<typeof messageRecordSchema>;

export type MessageIndexEntry = Pick<
  MessageRecord,
  "sessionId" | "createdAt" | "status"
>;

export function deriveMessageStatusFromRecipients(
  recipientStatuses: readonly MessageRecipientStatus[],
): MessageStatus {
  const hasSuccess = recipientStatuses.some((status) => status === "succeeded");
  return hasSuccess ? "succeeded" : "failed";
}
