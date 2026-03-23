import { executeCompetitionWithAdapter } from "../../../competition/command-adapter.js";
import type { ResolvedExtraContextFile } from "../../../competition/shared/extra-context.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { VerificationConfig } from "../../../configs/verification/types.js";
import type { VerifyProgressRenderer } from "../../../render/transcripts/verify.js";
import type { VerificationRecordMutators } from "../model/mutators.js";
import type { VerificationRecord } from "../model/types.js";
import {
  createVerifyCompetitionAdapter,
  type VerifyCompetitionCandidate,
} from "./adapter.js";
import { loadRubricTemplate } from "./prompt.js";
import {
  cleanupSharedVerificationInputs,
  prepareSharedVerificationInputs,
} from "./shared-layout.js";
import type { ResolvedVerificationTarget } from "./target.js";

export async function executeAndPersistRubricMethods(options: {
  root: string;
  verificationId: string;
  resolvedTarget: ResolvedVerificationTarget;
  verificationConfig: VerificationConfig;
  verifierAgents: readonly AgentDefinition[];
  aliasMap?: Record<string, string>;
  environment: EnvironmentConfig;
  extraContextFiles: readonly ResolvedExtraContextFile[];
  maxParallel: number;
  mutators: VerificationRecordMutators;
  renderer?: VerifyProgressRenderer;
}): Promise<VerificationRecord["methods"]> {
  const {
    root,
    verificationId,
    resolvedTarget,
    verificationConfig,
    verifierAgents,
    aliasMap,
    environment,
    extraContextFiles,
    maxParallel,
    mutators,
    renderer,
  } = options;

  const rubricTemplates =
    resolvedTarget.target.kind === "spec"
      ? verificationConfig.spec.rubric
      : resolvedTarget.target.kind === "run"
        ? verificationConfig.run.rubric
        : verificationConfig.reduce.rubric;

  if (rubricTemplates.length === 0 || verifierAgents.length === 0) {
    return [];
  }

  const sharedInputs = await prepareSharedVerificationInputs({
    root,
    verificationId,
    resolvedTarget,
    aliasMap,
  });

  try {
    const loadedTemplates = await Promise.all(
      rubricTemplates.map(async (rubric) => ({
        rubric,
        template: await loadRubricTemplate({
          root,
          template: rubric.template,
        }),
      })),
    );

    const candidates: VerifyCompetitionCandidate[] = loadedTemplates.flatMap(
      ({ template }) =>
        verifierAgents.map((agent) => ({
          agent,
          template,
        })),
    );

    const executions = await executeCompetitionWithAdapter({
      candidates,
      maxParallel,
      adapter: createVerifyCompetitionAdapter({
        root,
        verificationId,
        resolvedTarget,
        aliasMap,
        environment,
        extraContextFiles,
        sharedInputs,
        mutators,
        renderer,
      }),
    });

    return executions.map((execution) => ({
      method: "rubric",
      template: execution.template,
      verifierId: execution.verifierId,
      scope:
        resolvedTarget.target.kind === "run"
          ? { kind: "run" }
          : { kind: "target" },
      status: execution.status,
      artifactPath: execution.artifactPath,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      tokenUsage: execution.tokenUsage,
      ...(execution.status === "failed" ? { error: execution.error } : {}),
    }));
  } finally {
    await cleanupSharedVerificationInputs({
      root,
      sharedInputs,
    });
  }
}
