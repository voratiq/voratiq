import { dirname, resolve } from "node:path";

import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { ProgrammaticCheckResult } from "../../../configs/verification/methods.js";
import type { VerificationConfig } from "../../../configs/verification/types.js";
import { emitStageProgressEvent } from "../../../render/transcripts/stage-progress.js";
import type { VerifyProgressRenderer } from "../../../render/transcripts/verify.js";
import { toErrorMessage } from "../../../utils/errors.js";
import { buildAgentWorkspacePaths } from "../../../workspace/layout.js";
import { getVerificationProgrammaticResultPath } from "../../../workspace/structure.js";
import type { VerificationRecordMutators } from "../model/mutators.js";
import type { VerificationRecord } from "../model/types.js";
import { executeProgrammaticChecks } from "../programmatic/runner.js";
import { writeVerificationArtifact } from "./artifacts.js";
import type { ResolvedVerificationTarget } from "./target.js";

export async function executeAndPersistProgrammaticMethod(options: {
  root: string;
  verificationId: string;
  resolvedTarget: ResolvedVerificationTarget;
  verificationConfig: VerificationConfig;
  environment: EnvironmentConfig;
  mutators: VerificationRecordMutators;
  renderer?: VerifyProgressRenderer;
}): Promise<VerificationRecord["methods"][number] | undefined> {
  const {
    root,
    verificationId,
    resolvedTarget,
    verificationConfig,
    environment,
    mutators,
    renderer,
  } = options;
  const methodPlan = resolveProgrammaticMethodPlan({
    resolvedTarget,
    verificationConfig,
  });
  if (methodPlan.kind === "none") {
    return undefined;
  }

  const startedAt = new Date().toISOString();
  const artifactPath = getVerificationProgrammaticResultPath(verificationId);
  const methodScope =
    "runRecord" in resolvedTarget
      ? ({ kind: "run" } as const)
      : ({ kind: "target" } as const);

  await mutators.recordMethodSnapshot({
    method: "programmatic",
    slug: "programmatic",
    scope: methodScope,
    status: "running",
    startedAt,
  });
  emitStageProgressEvent(renderer, {
    type: "stage.candidate",
    stage: "verify",
    candidate: {
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "running",
      startedAt,
      artifactPath,
    },
  });

  try {
    if (methodPlan.kind === "run" && "runRecord" in resolvedTarget) {
      const candidates = await Promise.all(
        resolvedTarget.target.candidateIds.map(async (candidateId) => {
          const paths = buildAgentWorkspacePaths({
            root,
            runId: resolvedTarget.target.sessionId,
            agentId: candidateId,
          });

          const logsDirectory = resolve(
            root,
            dirname(artifactPath),
            candidateId,
          );

          const outcome = await executeProgrammaticChecks({
            checks: methodPlan.checks,
            cwd: paths.workspacePath,
            root,
            logsDirectory,
            environment,
            envDirectoryGuard: {
              trustedAbsoluteRoots: [
                paths.workspacePath,
                paths.agentRoot,
                paths.sandboxHomePath,
              ],
              includeHomeForPythonStack: true,
              failOnDirectoryPreparationError: true,
            },
          });

          return {
            candidateId,
            results: outcome.results,
          };
        }),
      );

      await writeVerificationArtifact({
        root,
        artifactPath,
        artifact: {
          method: "programmatic",
          generatedAt: new Date().toISOString(),
          target: resolvedTarget.target,
          scope: "run",
          candidates,
        } as const,
      });

      const completedRef = {
        method: "programmatic" as const,
        slug: "programmatic" as const,
        scope: methodScope,
        status: "succeeded" as const,
        artifactPath,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      await mutators.recordMethodSnapshot(completedRef);
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "verify",
        candidate: {
          methodKey: "programmatic",
          verifierLabel: "programmatic",
          status: "succeeded",
          startedAt,
          completedAt: completedRef.completedAt,
          artifactPath,
        },
      });
      return completedRef;
    }

    throw new Error(
      `Programmatic verification is only supported for run targets; \`${resolvedTarget.target.kind}\` targets must use rubric verification.`,
    );
  } catch (error) {
    const completedAt = new Date().toISOString();
    const errorMessage = toErrorMessage(error);
    await writeFailureProgrammaticArtifact({
      root,
      artifactPath,
      resolvedTarget,
      generatedAt: completedAt,
      error: errorMessage,
    });
    const failedRef = {
      method: "programmatic",
      slug: "programmatic",
      scope: methodScope,
      status: "failed",
      artifactPath,
      startedAt,
      completedAt,
      error: errorMessage,
    } as const;
    await mutators.recordMethodSnapshot(failedRef);
    emitStageProgressEvent(renderer, {
      type: "stage.candidate",
      stage: "verify",
      candidate: {
        methodKey: "programmatic",
        verifierLabel: "programmatic",
        status: "failed",
        startedAt,
        completedAt,
        artifactPath,
      },
    });
    return failedRef;
  }
}

function resolveProgrammaticMethodPlan(options: {
  resolvedTarget: ResolvedVerificationTarget;
  verificationConfig: VerificationConfig;
}):
  | { kind: "none" }
  | { kind: "run"; checks: Array<{ slug: string; command: string }> }
  | {
      kind: "unsupported";
      targetKind: "spec" | "reduce";
      checks: Array<{ slug: string; command: string }>;
    } {
  const { resolvedTarget, verificationConfig } = options;
  if (resolvedTarget.target.kind === "run") {
    const checks = verificationConfig.run.programmatic.reduce<
      Array<{ slug: string; command: string }>
    >((plan, entry) => {
      const command = entry.command?.trim();
      if (command) {
        plan.push({ slug: entry.slug, command });
      }
      return plan;
    }, []);
    if (checks.length === 0) {
      return { kind: "none" };
    }
    return {
      kind: "run",
      checks,
    };
  }

  const configuredChecks = extractUnsupportedProgrammaticChecks(
    resolvedTarget.target.kind === "spec"
      ? verificationConfig.spec
      : verificationConfig.reduce,
  );
  if (configuredChecks.length === 0) {
    return { kind: "none" };
  }

  const checks = configuredChecks.reduce<
    Array<{ slug: string; command: string }>
  >((plan, entry) => {
    const command = entry.command?.trim();
    if (command) {
      plan.push({ slug: entry.slug, command });
    }
    return plan;
  }, []);
  if (checks.length === 0) {
    return { kind: "none" };
  }

  return {
    kind: "unsupported",
    targetKind: resolvedTarget.target.kind,
    checks,
  };
}

function extractUnsupportedProgrammaticChecks(
  stageConfig: VerificationConfig["spec"],
): Array<{ slug: string; command?: string }> {
  const rawEntries: unknown = Reflect.get(stageConfig, "programmatic");
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  return rawEntries.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const slugValue: unknown = Reflect.get(entry, "slug");
    const commandValue: unknown = Reflect.get(entry, "command");
    const slug = typeof slugValue === "string" ? slugValue : undefined;
    const command = typeof commandValue === "string" ? commandValue : undefined;
    return slug ? [{ slug, ...(command ? { command } : {}) }] : [];
  });
}

async function writeFailureProgrammaticArtifact(options: {
  root: string;
  artifactPath: string;
  resolvedTarget: ResolvedVerificationTarget;
  generatedAt: string;
  error: string;
}): Promise<void> {
  const { root, artifactPath, resolvedTarget, generatedAt, error } = options;

  if ("runRecord" in resolvedTarget) {
    await writeVerificationArtifact({
      root,
      artifactPath,
      artifact: {
        method: "programmatic",
        generatedAt,
        status: "failed",
        error,
        target: resolvedTarget.target,
        scope: "run",
        candidates: [],
      } as const,
    });
    return;
  }

  await writeVerificationArtifact({
    root,
    artifactPath,
    artifact: {
      method: "programmatic",
      generatedAt,
      status: "failed",
      error,
      target: resolvedTarget.target,
      scope: "target",
      results: [] as ProgrammaticCheckResult[],
    } as const,
  });
}
