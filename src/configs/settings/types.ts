import { z } from "zod";

export const codexGlobalConfigPolicySchema = z.enum(["ignore", "apply"]);
export const mcpPreferenceSchema = z.enum(["ask", "never"]);

export type CodexGlobalConfigPolicy = z.infer<
  typeof codexGlobalConfigPolicySchema
>;
export type McpPreference = z.infer<typeof mcpPreferenceSchema>;

export interface RepoSettings {
  bounded: {
    codex: {
      globalConfigPolicy: CodexGlobalConfigPolicy;
    };
  };
  mcp: {
    codex: McpPreference;
    claude: McpPreference;
    gemini: McpPreference;
  };
}

export const repoSettingsSchema = z
  .object({
    bounded: z
      .object({
        codex: z
          .object({
            globalConfigPolicy: codexGlobalConfigPolicySchema.optional(),
          })
          .optional(),
      })
      .optional(),
    mcp: z
      .object({
        codex: mcpPreferenceSchema.optional(),
        claude: mcpPreferenceSchema.optional(),
        gemini: mcpPreferenceSchema.optional(),
      })
      .optional(),
  })
  .passthrough();
