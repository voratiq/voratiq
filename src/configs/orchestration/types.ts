import { z } from "zod";

import { agentIdSchema } from "../agents/types.js";

export const ORCHESTRATION_STAGE_IDS = ["run", "review", "spec"] as const;
export type OrchestrationStageId = (typeof ORCHESTRATION_STAGE_IDS)[number];

export const orchestrationStageAgentSchema = z
  .object({
    id: agentIdSchema,
  })
  .strict();

export type OrchestrationStageAgent = z.infer<
  typeof orchestrationStageAgentSchema
>;

export const orchestrationStageSchema = z
  .object({
    agents: z.array(orchestrationStageAgentSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.agents.forEach((agent, index) => {
      if (seen.has(agent.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", index, "id"],
          message: `duplicate stage agent id \`${agent.id}\``,
        });
        return;
      }
      seen.add(agent.id);
    });
  });

export type OrchestrationStageConfig = z.infer<typeof orchestrationStageSchema>;

export const orchestrationProfileSchema = z
  .object({
    run: orchestrationStageSchema,
    review: orchestrationStageSchema,
    spec: orchestrationStageSchema,
  })
  .strict();

export type OrchestrationProfile = z.infer<typeof orchestrationProfileSchema>;

export const orchestrationConfigSchema = z
  .object({
    profiles: z
      .object({
        default: orchestrationProfileSchema,
      })
      .strict(),
  })
  .strict();

export type OrchestrationConfig = z.infer<typeof orchestrationConfigSchema>;
