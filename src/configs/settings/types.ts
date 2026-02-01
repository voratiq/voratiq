import { z } from "zod";

export const codexGlobalConfigPolicySchema = z.enum(["ignore", "apply"]);

export type CodexGlobalConfigPolicy = z.infer<
  typeof codexGlobalConfigPolicySchema
>;

export interface RepoSettings {
  codex: {
    globalConfigPolicy: CodexGlobalConfigPolicy;
  };
}

export const repoSettingsSchema = z
  .object({
    codex: z
      .object({
        globalConfigPolicy: codexGlobalConfigPolicySchema.optional(),
      })
      .optional(),
  })
  .passthrough();
