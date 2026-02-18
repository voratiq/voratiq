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

export const ORCHESTRATION_PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
export const ORCHESTRATION_PROFILE_NAME_MAX_LENGTH = 64;

export const orchestrationProfileNameSchema = z
  .string()
  .max(
    ORCHESTRATION_PROFILE_NAME_MAX_LENGTH,
    `profile name must be ${ORCHESTRATION_PROFILE_NAME_MAX_LENGTH} characters or fewer`,
  )
  .regex(
    ORCHESTRATION_PROFILE_NAME_PATTERN,
    "profile name must match /^[a-z0-9][a-z0-9-]*$/",
  );

export const orchestrationProfilesSchema = z
  .record(orchestrationProfileNameSchema, orchestrationProfileSchema)
  .superRefine((profiles, ctx) => {
    if (!Object.hasOwn(profiles, "default")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["default"],
        message: "required",
      });
    }
  });

export type OrchestrationProfiles = z.infer<typeof orchestrationProfilesSchema>;

export const orchestrationConfigSchema = z
  .object({
    profiles: orchestrationProfilesSchema,
  })
  .strict();

export type OrchestrationConfig = z.infer<typeof orchestrationConfigSchema>;
