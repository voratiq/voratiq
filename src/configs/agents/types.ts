import { z } from "zod";

export const agentIdSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/u, {
  message: "Agent id must match /^[a-z0-9_-]{1,32}$/",
});
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentConfigEntrySchema = z.object({
  id: agentIdSchema,
  provider: z.string().min(1, { message: "Agent provider cannot be empty" }),
  model: z.string().min(1, { message: "Agent model cannot be empty" }),
  enabled: z.boolean().optional().default(true),
  binary: z.string().optional().default(""),
  extraArgs: z
    .array(
      z
        .string()
        .trim()
        .min(1, { message: "`extraArgs` entries cannot be empty" }),
    )
    .nonempty({ message: "`extraArgs` must include at least one value" })
    .optional(),
});

export type AgentConfigEntry = z.infer<typeof agentConfigEntrySchema>;

export const agentsConfigSchema = z.object({
  agents: z.array(agentConfigEntrySchema).default([]),
});

export type AgentsConfig = z.infer<typeof agentsConfigSchema>;

export const agentDefinitionSchema = z.object({
  id: agentIdSchema,
  provider: z.string().min(1, { message: "Agent provider cannot be empty" }),
  model: z.string().min(1, { message: "Agent model cannot be empty" }),
  binary: z.string(),
  argv: z
    .array(z.string())
    .min(1, { message: "Agent argv must include at least one argument" }),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const agentCatalogSchema = z.array(agentDefinitionSchema);
export type AgentCatalog = z.infer<typeof agentCatalogSchema>;
