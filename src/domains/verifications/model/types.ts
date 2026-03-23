import { z } from "zod";

import { agentIdSchema } from "../../../configs/agents/types.js";
import {
  programmaticCheckResultSchema,
  programmaticSlugSchema,
  rubricTemplateSchema,
} from "../../../configs/verification/methods.js";
import {
  extraContextMetadataEntrySchema,
  persistedExtraContextPathSchema,
} from "../../../persistence/extra-context.js";
import { repoRelativeRecordPathSchema } from "../../../persistence/record-path-schema.js";
import {
  TERMINAL_VERIFICATION_STATUSES,
  type VerificationStatus,
  verificationStatusSchema,
} from "../../../status/index.js";
import { extractedTokenUsageSchema } from "../../runs/model/types.js";
import { validateRecordLifecycleTimestamps } from "../../shared/lifecycle.js";
import { BLINDED_ALIAS_PATTERN } from "../blinding/aliases.js";
import {
  rubricResultPayloadSchema,
  safeParseRubricRecommendationFromResult,
} from "../rubric-result.js";
export {
  TERMINAL_VERIFICATION_STATUSES,
  verificationStatusSchema,
} from "../../../status/index.js";
export type {
  RubricRecommendation,
  RubricResultPayload,
} from "../rubric-result.js";
export type { VerificationStatus };

const VERIFICATION_TARGET_KIND_VALUES = ["spec", "run", "reduce"] as const;
const VERIFICATION_METHOD_KIND_VALUES = ["programmatic", "rubric"] as const;
const VERIFICATION_SCOPE_KIND_VALUES = ["target", "run", "candidate"] as const;
const RUBRIC_FINDING_SEVERITY_VALUES = ["info", "warning", "error"] as const;

export type VerificationTargetKind =
  (typeof VERIFICATION_TARGET_KIND_VALUES)[number];
export type VerificationMethodKind =
  (typeof VERIFICATION_METHOD_KIND_VALUES)[number];
export type VerificationScopeKind =
  (typeof VERIFICATION_SCOPE_KIND_VALUES)[number];

export const verificationTargetKindSchema = z.enum(
  VERIFICATION_TARGET_KIND_VALUES,
);
export const verificationMethodKindSchema = z.enum(
  VERIFICATION_METHOD_KIND_VALUES,
);
export const verificationScopeKindSchema = z.enum(
  VERIFICATION_SCOPE_KIND_VALUES,
);

const verificationResultArtifactPathSchema =
  repoRelativeRecordPathSchema.refine(
    (value) => value.endsWith("/result.json") || value.endsWith(".result.json"),
    {
      message:
        "verification result artifact paths must end with `/result.json` or `.result.json`",
    },
  );

export const specVerificationTargetSchema = z
  .object({
    kind: z.literal("spec"),
    sessionId: z.string().min(1),
    specPath: repoRelativeRecordPathSchema.optional(),
  })
  .strict();

export const runVerificationTargetSchema = z
  .object({
    kind: z.literal("run"),
    sessionId: z.string().min(1),
    candidateIds: z.array(agentIdSchema).min(1),
  })
  .strict();

export const reduceVerificationTargetSchema = z
  .object({
    kind: z.literal("reduce"),
    sessionId: z.string().min(1),
  })
  .strict();

export const verificationTargetSchema = z.discriminatedUnion("kind", [
  specVerificationTargetSchema,
  runVerificationTargetSchema,
  reduceVerificationTargetSchema,
]);

export type VerificationTarget = z.infer<typeof verificationTargetSchema>;

export const verificationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("target") }).strict(),
  z.object({ kind: z.literal("run") }).strict(),
  z
    .object({
      kind: z.literal("candidate"),
      candidateId: agentIdSchema,
    })
    .strict(),
]);

export type VerificationScope = z.infer<typeof verificationScopeSchema>;

const blindedAliasSchema = z.string().regex(BLINDED_ALIAS_PATTERN, {
  message: "Blinded alias must match /^v_[a-z0-9]{10,16}$/",
});

const blindedAliasMapSchema = z.record(blindedAliasSchema, agentIdSchema);

export const verificationMethodResultRefSchema = z
  .object({
    method: verificationMethodKindSchema,
    slug: programmaticSlugSchema.optional(),
    scope: verificationScopeSchema,
    status: verificationStatusSchema,
    artifactPath: verificationResultArtifactPathSchema.optional(),
    verifierId: agentIdSchema.optional(),
    template: rubricTemplateSchema.optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    tokenUsage: extractedTokenUsageSchema.optional(),
    error: z.string().nullable().optional(),
  })
  .superRefine((entry, ctx) => {
    const isTerminal = TERMINAL_VERIFICATION_STATUSES.includes(entry.status);

    if (entry.method === "programmatic") {
      if (entry.slug !== "programmatic") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slug"],
          message: "programmatic method refs must use slug `programmatic`",
        });
      }
      if (entry.verifierId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["verifierId"],
          message: "programmatic method refs must not set `verifierId`",
        });
      }
      if (entry.template !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["template"],
          message: "programmatic method refs must not set `template`",
        });
      }
    }

    if (entry.method === "rubric") {
      if (entry.slug !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slug"],
          message: "rubric method refs must not set `slug`",
        });
      }
      if (!entry.verifierId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["verifierId"],
          message: "rubric method refs must set `verifierId`",
        });
      }
      if (!entry.template) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["template"],
          message: "rubric method refs must set `template`",
        });
      }
    }

    if (isTerminal && !entry.artifactPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactPath"],
        message:
          "terminal verification method refs must persist a verification result artifact path",
      });
    }
  });

export type VerificationMethodResultRef = z.infer<
  typeof verificationMethodResultRefSchema
>;

export const rubricFindingSeveritySchema = z.enum(
  RUBRIC_FINDING_SEVERITY_VALUES,
);

export const rubricFindingSchema = z
  .object({
    severity: rubricFindingSeveritySchema,
    message: z.string().min(1),
  })
  .strict();

export type RubricFinding = z.infer<typeof rubricFindingSchema>;

const programmaticCandidateResultSchema = z
  .object({
    candidateId: agentIdSchema,
    results: z.array(programmaticCheckResultSchema),
  })
  .strict();

export const programmaticResultArtifactSchema = z.discriminatedUnion("scope", [
  z
    .object({
      method: z.literal("programmatic"),
      generatedAt: z.string(),
      status: verificationStatusSchema.optional(),
      error: z.string().nullable().optional(),
      target: z.union([
        specVerificationTargetSchema,
        reduceVerificationTargetSchema,
      ]),
      scope: z.literal("target"),
      results: z.array(programmaticCheckResultSchema),
    })
    .strict(),
  z
    .object({
      method: z.literal("programmatic"),
      generatedAt: z.string(),
      status: verificationStatusSchema.optional(),
      error: z.string().nullable().optional(),
      target: runVerificationTargetSchema,
      scope: z.literal("run"),
      candidates: z.array(programmaticCandidateResultSchema),
    })
    .strict(),
]);

export type ProgrammaticResultArtifact = z.infer<
  typeof programmaticResultArtifactSchema
>;

export const rubricResultArtifactSchema = z
  .object({
    method: z.literal("rubric"),
    template: rubricTemplateSchema,
    verifierId: agentIdSchema,
    generatedAt: z.string(),
    status: verificationStatusSchema,
    result: rubricResultPayloadSchema,
    error: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const validation = safeParseRubricRecommendationFromResult(artifact.result);
    if (validation.success) {
      return;
    }

    for (const issue of validation.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", ...issue.path],
        message: issue.message,
      });
    }
  });

export type RubricResultArtifact = z.infer<typeof rubricResultArtifactSchema>;

export const verificationResultArtifactSchema = z.union([
  programmaticResultArtifactSchema,
  rubricResultArtifactSchema,
]);

export type VerificationResultArtifact = z.infer<
  typeof verificationResultArtifactSchema
>;

export const verificationRecordSchema = z
  .object({
    sessionId: z.string().min(1),
    createdAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    status: verificationStatusSchema,
    target: verificationTargetSchema,
    extraContext: z.array(persistedExtraContextPathSchema).optional(),
    extraContextMetadata: z.array(extraContextMetadataEntrySchema).optional(),
    blinded: z
      .object({
        enabled: z.literal(true),
        aliasMap: blindedAliasMapSchema,
      })
      .optional(),
    methods: z.array(verificationMethodResultRefSchema),
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
        queued: ["queued"],
        running: ["running"],
        terminal: TERMINAL_VERIFICATION_STATUSES,
      },
    );

    const methodKeySet = new Set<string>();

    for (const method of record.methods) {
      const key =
        method.method === "programmatic"
          ? `${method.method}:${method.scope.kind}`
          : `${method.method}:${method.template}:${method.verifierId}:${method.scope.kind}:${method.scope.kind === "candidate" ? method.scope.candidateId : "_"}`;
      if (methodKeySet.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["methods"],
          message: `duplicate verification method ref: ${key}`,
        });
      }
      methodKeySet.add(key);

      if (record.target.kind === "run") {
        if (method.method === "rubric" && method.scope.kind === "target") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["methods"],
            message:
              "run-target rubric refs must use explicit `run` or `candidate` scope",
          });
        }
        if (
          method.scope.kind === "candidate" &&
          !record.target.candidateIds.includes(method.scope.candidateId)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["methods"],
            message: `candidate scope references unknown run candidate \`${method.scope.candidateId}\``,
          });
        }
      } else if (method.scope.kind !== "target") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["methods"],
          message:
            "spec and reduce verification refs must use `target` scope only",
        });
      }
    }
  });

export type VerificationRecord = z.infer<typeof verificationRecordSchema>;

export const verificationIndexEntrySchema = z
  .object({
    sessionId: z.string().min(1),
    createdAt: z.string(),
    status: verificationStatusSchema,
    targetKind: verificationTargetKindSchema,
    targetSessionId: z.string().min(1),
  })
  .strict();

export type VerificationIndexEntry = z.infer<
  typeof verificationIndexEntrySchema
>;
