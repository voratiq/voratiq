import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../persistence/record-path-schema.js";
import {
  type SpecRecordStatus,
  specRecordStatusSchema,
  TERMINAL_SPEC_STATUSES,
} from "../../status/index.js";

export type { SpecRecordStatus };
export { specRecordStatusSchema, TERMINAL_SPEC_STATUSES };

export const specRecordSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  status: specRecordStatusSchema,
  extraContext: z.array(persistedExtraContextPathSchema).optional(),
  extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
  agentId: agentIdSchema,
  title: z.string(),
  slug: z.string(),
  outputPath: repoRelativeRecordPathSchema,
  error: z.string().nullable().optional(),
});

export type SpecRecord = z.infer<typeof specRecordSchema>;

export type SpecIndexEntry = Pick<
  SpecRecord,
  "sessionId" | "createdAt" | "status"
>;
