import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import { extractedTokenUsageSchema } from "../../../domains/runs/model/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  type SpecRecordStatus,
  specRecordStatusSchema,
  TERMINAL_SPEC_STATUSES,
} from "../../../status/index.js";
import { validateRecordLifecycleTimestamps } from "../../shared/lifecycle.js";

export type { SpecRecordStatus };
export { specRecordStatusSchema, TERMINAL_SPEC_STATUSES };

const IN_PROGRESS_SPEC_STATUSES = [
  "drafting",
  "saving",
] as const satisfies readonly SpecRecordStatus[];

export const specRecordSchema = z
  .object({
    sessionId: z.string(),
    createdAt: z.string(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    status: specRecordStatusSchema,
    extraContext: z.array(persistedExtraContextPathSchema).optional(),
    extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
    agentId: agentIdSchema,
    tokenUsage: extractedTokenUsageSchema.optional(),
    title: z.string(),
    slug: z.string(),
    outputPath: repoRelativeRecordPathSchema,
    error: z.string().nullable().optional(),
  })
  .superRefine((record, ctx) => {
    // Enforce the canonical running/terminal timestamp contract.
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
        running: IN_PROGRESS_SPEC_STATUSES,
        terminal: TERMINAL_SPEC_STATUSES,
      },
    );
  });

export type SpecRecord = z.infer<typeof specRecordSchema>;

export type SpecIndexEntry = Pick<
  SpecRecord,
  "sessionId" | "createdAt" | "status"
>;
