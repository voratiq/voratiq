import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";

const INTERACTIVE_SESSION_STATUS_VALUES = [
  "running",
  "succeeded",
  "failed",
] as const;

const TOOL_ATTACHMENT_STATUS_VALUES = [
  "not-requested",
  "attached",
  "failed",
] as const;

const CHAT_ARTIFACT_FORMAT_VALUES = ["json", "jsonl"] as const;

const INTERACTIVE_LAUNCH_FAILURE_CODE_VALUES = [
  "provider_resolution_failed",
  "auth_staging_failed",
  "binary_resolution_failed",
  "config_generation_failed",
  "process_spawn_failed",
  "provider_launch_failed",
] as const;

export const interactiveSessionStatusSchema = z.enum(
  INTERACTIVE_SESSION_STATUS_VALUES,
);
export type InteractiveSessionStatus = z.infer<
  typeof interactiveSessionStatusSchema
>;

export const toolAttachmentStatusSchema = z.enum(TOOL_ATTACHMENT_STATUS_VALUES);
export type ToolAttachmentStatus = z.infer<typeof toolAttachmentStatusSchema>;

export const interactiveLaunchFailureCodeSchema = z.enum(
  INTERACTIVE_LAUNCH_FAILURE_CODE_VALUES,
);
export type InteractiveLaunchFailureCode = z.infer<
  typeof interactiveLaunchFailureCodeSchema
>;

export const interactiveSessionIndexEntrySchema = z
  .object({
    sessionId: z.string().min(1),
    createdAt: z.string().min(1),
    status: interactiveSessionStatusSchema,
  })
  .strict();
export type InteractiveSessionIndexEntry = z.infer<
  typeof interactiveSessionIndexEntrySchema
>;

export const interactiveSessionIndexRecordSchema = z
  .object({
    version: z.literal(1),
    sessions: z.array(interactiveSessionIndexEntrySchema),
  })
  .strict();
export type InteractiveSessionIndexRecord = z.infer<
  typeof interactiveSessionIndexRecordSchema
>;

export const interactiveSessionErrorRecordSchema = z
  .object({
    code: interactiveLaunchFailureCodeSchema,
    message: z.string().min(1),
  })
  .strict();
export type InteractiveSessionErrorRecord = z.infer<
  typeof interactiveSessionErrorRecordSchema
>;

const chatArtifactFormatSchema = z.enum(CHAT_ARTIFACT_FORMAT_VALUES);

export const interactiveSessionChatRecordSchema = z
  .object({
    captured: z.boolean(),
    format: chatArtifactFormatSchema.optional(),
    artifactPath: repoRelativeRecordPathSchema.optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((chat, ctx) => {
    if (chat.captured) {
      if (!chat.format) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["format"],
          message: "captured interactive chat must persist `format`",
        });
      }
      if (!chat.artifactPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactPath"],
          message:
            "captured interactive chat must persist a repo-relative `artifactPath`",
        });
      }
    }
  });
export type InteractiveSessionChatRecord = z.infer<
  typeof interactiveSessionChatRecordSchema
>;

export const interactiveSessionRecordSchema = z
  .object({
    sessionId: z.string().min(1),
    createdAt: z.string().min(1),
    status: interactiveSessionStatusSchema,
    agentId: agentIdSchema,
    task: z.string().min(1).optional(),
    toolAttachmentStatus: toolAttachmentStatusSchema,
    chat: interactiveSessionChatRecordSchema.optional(),
    error: interactiveSessionErrorRecordSchema.optional(),
  })
  .strict();
export type InteractiveSessionRecord = z.infer<
  typeof interactiveSessionRecordSchema
>;
