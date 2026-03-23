import type { VerificationConfig } from "../../configs/verification/types.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";

export function resolveVerifyRubricMaxParallel(options: {
  targetKind: "spec" | "run" | "reduce";
  verificationConfig: VerificationConfig;
  verifierAgentCount: number;
  requestedMaxParallel?: number;
}): number {
  const {
    targetKind,
    verificationConfig,
    verifierAgentCount,
    requestedMaxParallel,
  } = options;

  const rubricTemplateCount =
    targetKind === "spec"
      ? verificationConfig.spec.rubric.length
      : targetKind === "run"
        ? verificationConfig.run.rubric.length
        : verificationConfig.reduce.rubric.length;

  return resolveEffectiveMaxParallel({
    competitorCount: verifierAgentCount * rubricTemplateCount,
    requestedMaxParallel,
  });
}
