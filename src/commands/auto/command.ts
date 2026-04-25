import type {
  AutoApplyStatus,
  AutoTerminalStatus,
} from "../../domain/run/model/types.js";
import type {
  AutoVerificationSelectionDisposition,
  SelectionDecision,
} from "../../policy/index.js";
import { classifyAutoVerificationSelection } from "../../policy/index.js";
import { mapRunStatusToExitCode, type RunStatus } from "../../status/index.js";
import { HintedError, toErrorMessage } from "../../utils/errors.js";
import { validateAutoCommandOptions } from "./validation.js";

export interface ExecuteAutoCommandInput {
  specPath?: string;
  description?: string;
  runAgentIds?: readonly string[];
  verifyAgentIds?: readonly string[];
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  apply?: boolean;
  commit?: boolean;
}

export interface AutoSpecStageInput {
  description: string;
  profile?: string;
  maxParallel?: number;
  suppressHint: boolean;
}

export interface AutoSpecStageResult {
  body: string;
  sessionId: string;
  generatedSpecPaths?: readonly string[];
  specPath?: string;
}

export interface AutoRunAgentResult {
  agentId: string;
}

export interface AutoRunStageReport {
  runId: string;
  status: RunStatus;
  createdAt: string;
  baseRevisionSha: string;
  spec?: {
    path?: string;
  };
  agents: readonly AutoRunAgentResult[];
}

export interface AutoRunStageInput {
  specPath: string;
  agentIds?: readonly string[];
  agentOverrideFlag: string;
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
}

export interface AutoRunStageResult {
  report: AutoRunStageReport;
  body: string;
  exitCode?: number;
}

export interface AutoVerifyStageInput {
  target: {
    kind: "spec" | "run";
    sessionId: string;
  };
  agentIds?: readonly string[];
  agentOverrideFlag: string;
  profile?: string;
  maxParallel?: number;
  suppressHint: boolean;
}

export interface AutoVerifyStageResult {
  verificationId?: string;
  body: string;
  stderr?: string;
  exitCode?: number;
  selectedSpecPath?: string;
  selection?: SelectionDecision;
  selectionWarnings?: readonly string[];
  warningMessage?: string;
}

export interface AutoApplyStageInput {
  runId: string;
  agentId: string;
  commit: boolean;
}

export interface AutoApplyStageResult {
  body: string;
  exitCode?: number;
}

export type AutoCommandEvent =
  | {
      kind: "body";
      body: string;
      stderr?: string;
      exitCode?: number;
    }
  | {
      kind: "warning";
      detail: string;
      separateWithDivider: boolean;
    }
  | {
      kind: "error";
      error: unknown;
    }
  | {
      kind: "action_required";
      detail: string;
      separateWithDivider: boolean;
    };

export interface AutoPhaseSummary {
  status: "succeeded" | "failed" | "aborted" | "skipped";
  durationMs?: number;
  detail?: string;
}

export interface AutoExecutionSummary {
  status: AutoTerminalStatus;
  totalDurationMs: number;
  spec: AutoPhaseSummary & { specPath?: string };
  run: AutoPhaseSummary & {
    runId?: string;
    runStatus?: RunStatus;
    createdAt?: string;
    specPath?: string;
    baseRevisionSha?: string;
  };
  verify: AutoPhaseSummary;
  apply: AutoPhaseSummary & { agentId?: string };
}

export interface ExecuteAutoCommandResult {
  exitCode: number;
  runId?: string;
  appliedAgentId?: string;
  auto: {
    status: AutoTerminalStatus;
    detail?: string;
  };
  apply: {
    status: AutoApplyStatus;
    detail?: string;
  };
  summary: AutoExecutionSummary;
  events: readonly AutoCommandEvent[];
}

export interface AutoCommandDependencies {
  now?: () => number;
  onEvent?: (event: AutoCommandEvent) => void;
  runSpecStage: (input: AutoSpecStageInput) => Promise<AutoSpecStageResult>;
  runRunStage: (input: AutoRunStageInput) => Promise<AutoRunStageResult>;
  runVerifyStage: (
    input: AutoVerifyStageInput,
  ) => Promise<AutoVerifyStageResult>;
  runApplyStage: (input: AutoApplyStageInput) => Promise<AutoApplyStageResult>;
}

export async function executeAutoCommand(
  options: ExecuteAutoCommandInput,
  dependencies: AutoCommandDependencies,
): Promise<ExecuteAutoCommandResult> {
  assertAutoOptionCompatibility(options);

  const hasDescription =
    typeof options.description === "string" &&
    options.description.trim().length > 0;
  const description =
    typeof options.description === "string" ? options.description : undefined;
  const now = dependencies.now ?? Date.now.bind(Date);
  const overallStart = now();
  const events: AutoCommandEvent[] = [];
  let bodyOutputEmitted = false;
  const recordEvent = (event: AutoCommandEvent): void => {
    events.push(event);
    if (event.kind === "body") {
      bodyOutputEmitted = true;
    }
    dependencies.onEvent?.(event);
  };

  let hardFailure = false;
  let hardAbort = false;
  let actionRequired = false;
  let actionRequiredDetail: string | undefined;

  let specStartedAt: number | undefined;
  let specStatus: "succeeded" | "failed" | "aborted" | "skipped" = "skipped";
  let specPath: string | undefined;
  let specDetail: string | undefined;
  let specSessionId: string | undefined;

  let runStartedAt: number | undefined;
  let runStatus: "succeeded" | "failed" | "aborted" | "skipped" = "skipped";
  let runId: string | undefined;
  let runDetail: string | undefined;
  let runRecordStatus: RunStatus | undefined;
  let runCreatedAt: string | undefined;
  let runSpecPath: string | undefined;
  let runBaseRevisionSha: string | undefined;

  let verifyStartedAt: number | undefined;
  let verifyStatus: "succeeded" | "failed" | "aborted" | "skipped" = "skipped";
  let verifyDetail: string | undefined;
  let verifySelection: SelectionDecision | undefined;

  let applyStartedAt: number | undefined;
  let applyStatus: AutoApplyStatus = "skipped";
  let applyAgentId: string | undefined;
  let applyDetail: string | undefined;

  const markActionRequired = (detail: string): void => {
    actionRequired = true;
    actionRequiredDetail = detail;
    applyStatus = "skipped";
    applyDetail = detail;
    recordEvent({
      kind: "action_required",
      detail,
      separateWithDivider: bodyOutputEmitted,
    });
  };

  let resolvedSpecPath = options.specPath;

  if (hasDescription && description) {
    specStartedAt = now();
    try {
      const specResult = await dependencies.runSpecStage({
        description,
        profile: options.profile,
        maxParallel: options.maxParallel,
        suppressHint: true,
      });
      specStatus = "succeeded";
      specSessionId = specResult.sessionId;
      recordEvent({ kind: "body", body: specResult.body });
    } catch (error) {
      specStatus = "failed";
      specDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  if (!hardFailure && !hardAbort && !actionRequired && hasDescription) {
    if (!specSessionId) {
      specStatus = "failed";
      specDetail = "Spec stage did not return a session id.";
      hardFailure = true;
    } else {
      try {
        const specVerifyResult = await dependencies.runVerifyStage({
          target: {
            kind: "spec",
            sessionId: specSessionId,
          },
          agentIds: options.verifyAgentIds
            ? [...options.verifyAgentIds]
            : undefined,
          agentOverrideFlag: "--verify-agent",
          profile: options.profile,
          maxParallel: options.maxParallel,
          suppressHint: true,
        });

        recordEvent({
          kind: "body",
          body: specVerifyResult.body,
          stderr: specVerifyResult.stderr,
          exitCode: specVerifyResult.exitCode,
        });

        if (
          typeof specVerifyResult.selectedSpecPath === "string" &&
          specVerifyResult.selectedSpecPath.trim().length > 0
        ) {
          resolvedSpecPath = specVerifyResult.selectedSpecPath;
          specPath = specVerifyResult.selectedSpecPath;
        } else if (specVerifyResult.selection?.state === "resolvable") {
          specStatus = "failed";
          specDetail =
            "Spec verification returned a resolvable selection without a selected spec path.";
          hardFailure = true;
        } else if (specVerifyResult.selection) {
          const specSelectionDisposition = classifyAutoVerificationSelection({
            selection: specVerifyResult.selection,
          });
          if (specSelectionDisposition.kind !== "action_required") {
            throw new Error(
              "Spec verification without a selected spec path must require manual action.",
            );
          }
          specDetail = specSelectionDisposition.detail;
          markActionRequired(specSelectionDisposition.detail);
        } else if (specVerifyResult.exitCode === 1) {
          specStatus = "failed";
          specDetail =
            specVerifyResult.warningMessage?.trim() ||
            "Spec verification did not produce any successful verifier results.";
          hardFailure = true;
        }
      } catch (error) {
        specStatus = "failed";
        specDetail = toHeadline(error);
        hardFailure = true;
        recordEvent({ kind: "error", error });
      }
    }
  }

  if (
    !resolvedSpecPath &&
    !hardFailure &&
    !hardAbort &&
    !actionRequired &&
    hasDescription
  ) {
    specStatus = "failed";
    specDetail = "Spec verification did not select a spec path.";
    hardFailure = true;
  }

  if (!hardFailure && !hardAbort && !actionRequired && resolvedSpecPath) {
    runStartedAt = now();

    try {
      const runResult = await dependencies.runRunStage({
        specPath: resolvedSpecPath,
        agentIds: options.runAgentIds ? [...options.runAgentIds] : undefined,
        agentOverrideFlag: "--run-agent",
        profile: options.profile,
        maxParallel: options.maxParallel,
        branch: options.branch,
      });

      const expectedRunExitCode = mapRunStatusToExitCode(
        runResult.report.status,
      );
      const resolvedRunExitCode =
        typeof runResult.exitCode === "number"
          ? runResult.exitCode
          : expectedRunExitCode;

      if (
        typeof runResult.exitCode === "number" &&
        runResult.exitCode !== expectedRunExitCode
      ) {
        throw new HintedError("Run status/exit code mismatch.", {
          detailLines: [
            `Status: \`${runResult.report.status}\`.`,
            `Exit code: ${runResult.exitCode}.`,
          ],
          hintLines: ["Re-run the command."],
        });
      }

      runStatus =
        resolvedRunExitCode === 0
          ? "succeeded"
          : runResult.report.status === "aborted"
            ? "aborted"
            : "failed";
      runId = runResult.report.runId;
      runRecordStatus = runResult.report.status;
      runCreatedAt = runResult.report.createdAt;
      runSpecPath = runResult.report.spec?.path;
      runBaseRevisionSha = runResult.report.baseRevisionSha;

      if (runStatus !== "succeeded") {
        const statusDetail = runRecordStatus
          ? `status \`${runRecordStatus}\``
          : "a non-success status";
        runDetail =
          runDetail ??
          `Run completed with ${statusDetail} (exit code ${resolvedRunExitCode}).`;
        if (runStatus === "aborted") {
          hardAbort = true;
        } else {
          hardFailure = true;
        }
      }

      recordEvent({
        kind: "body",
        body: runResult.body,
        exitCode: runResult.exitCode,
      });
    } catch (error) {
      runStatus = "failed";
      runDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  const shouldAttemptVerifyRun =
    runId !== undefined &&
    runStatus === "succeeded" &&
    !hardFailure &&
    !hardAbort &&
    !actionRequired;

  if (shouldAttemptVerifyRun && runId) {
    verifyStartedAt = now();

    try {
      const verifyResult = await dependencies.runVerifyStage({
        target: {
          kind: "run",
          sessionId: runId,
        },
        agentIds: options.verifyAgentIds
          ? [...options.verifyAgentIds]
          : undefined,
        agentOverrideFlag: "--verify-agent",
        profile: options.profile,
        maxParallel: options.maxParallel,
        suppressHint: options.apply === true,
      });

      verifyStatus = "succeeded";
      verifySelection = verifyResult.selection;

      recordEvent({
        kind: "body",
        body: verifyResult.body,
        stderr: verifyResult.stderr,
        exitCode: verifyResult.exitCode,
      });

      for (const warning of verifyResult.selectionWarnings ?? []) {
        verifyDetail = warning;
        recordEvent({
          kind: "warning",
          detail: warning,
          separateWithDivider: bodyOutputEmitted,
        });
      }

      if (
        options.apply === true &&
        (verifyResult.selectionWarnings?.length ?? 0) > 0
      ) {
        const warningDetail =
          "Verification reported warnings for the selected candidate; automatic apply halted. Review the verify output and apply manually if appropriate.";
        verifyDetail = warningDetail;
        markActionRequired(warningDetail);
      }

      if (verifySelection?.state === "unresolved") {
        const verifySelectionDisposition = classifyAutoVerificationSelection({
          selection: verifySelection,
        });
        applyAutoVerificationSelectionDisposition({
          disposition: verifySelectionDisposition,
          onActionRequired: markActionRequired,
          onVerifyDetail: (detail) => {
            verifyDetail = detail;
          },
        });
      } else if (verifyResult.exitCode === 1) {
        verifyStatus = "failed";
        verifyDetail =
          verifyResult.warningMessage?.trim() ||
          "Verification did not produce any successful verifier results.";
        hardFailure = true;
      }
    } catch (error) {
      verifyStatus = "failed";
      verifyDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  if (
    options.apply &&
    runId &&
    verifyStatus === "succeeded" &&
    !actionRequired &&
    (!hasDescription || runStatus === "succeeded")
  ) {
    applyStartedAt = now();
    try {
      if (!verifySelection) {
        throw new HintedError(
          "Verify stage did not return a selection policy.",
          {
            hintLines: [
              "Re-run `voratiq verify` to regenerate verification data.",
            ],
          },
        );
      }

      classifyAutoVerificationSelection({
        selection: verifySelection,
      });

      if (verifySelection.state !== "resolvable") {
        throw new HintedError(
          "Verify stage did not return a resolvable selection.",
          {
            hintLines: [
              "Re-run `voratiq verify` to inspect the unresolved decision.",
            ],
          },
        );
      } else {
        const applyResult = await dependencies.runApplyStage({
          runId,
          agentId: verifySelection.selectedCanonicalAgentId,
          commit: options.commit ?? false,
        });

        applyStatus = "succeeded";
        applyAgentId = verifySelection.selectedCanonicalAgentId;

        recordEvent({
          kind: "body",
          body: applyResult.body,
          exitCode: applyResult.exitCode,
        });
        if (applyResult.exitCode === 1) {
          applyStatus = "failed";
          applyDetail = "Apply stage reported a non-zero exit code.";
          hardFailure = true;
        }
      }
    } catch (error) {
      applyStatus = "failed";
      applyDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  const overallDurationMs = now() - overallStart;
  const specDurationMs =
    specStartedAt !== undefined ? now() - specStartedAt : undefined;
  const runDurationMs =
    runStartedAt !== undefined ? now() - runStartedAt : undefined;
  const verifyDurationMs =
    verifyStartedAt !== undefined ? now() - verifyStartedAt : undefined;
  const applyDurationMs =
    applyStartedAt !== undefined ? now() - applyStartedAt : undefined;

  const autoStatus = resolveAutoTerminalStatus({
    hardFailure,
    hardAbort,
    actionRequired,
  });
  const autoDetail = resolveAutoTerminalDetail({
    status: autoStatus,
    actionRequiredDetail,
    applyDetail,
    verifyDetail,
    runDetail,
    specDetail,
  });
  const normalizedApplyDetail = truncateOutcomeDetail(applyDetail);
  const exitCode = mapAutoTerminalStatusToExitCode(autoStatus);

  return {
    exitCode,
    runId,
    ...(applyAgentId ? { appliedAgentId: applyAgentId } : {}),
    auto: {
      status: autoStatus,
      ...(autoDetail ? { detail: autoDetail } : {}),
    },
    apply: {
      status: applyStatus,
      ...(normalizedApplyDetail ? { detail: normalizedApplyDetail } : {}),
    },
    summary: {
      status: autoStatus,
      totalDurationMs: overallDurationMs,
      spec: {
        status: specStatus,
        ...(typeof specDurationMs === "number"
          ? { durationMs: specDurationMs }
          : {}),
        ...(specPath ? { specPath } : {}),
        ...(specDetail ? { detail: specDetail } : {}),
      },
      run: {
        status: runStatus,
        ...(typeof runDurationMs === "number"
          ? { durationMs: runDurationMs }
          : {}),
        ...(runId ? { runId } : {}),
        ...(runRecordStatus ? { runStatus: runRecordStatus } : {}),
        ...(runCreatedAt ? { createdAt: runCreatedAt } : {}),
        ...(runSpecPath ? { specPath: runSpecPath } : {}),
        ...(runBaseRevisionSha ? { baseRevisionSha: runBaseRevisionSha } : {}),
        ...(runDetail ? { detail: runDetail } : {}),
      },
      verify: {
        status: verifyStatus,
        ...(typeof verifyDurationMs === "number"
          ? { durationMs: verifyDurationMs }
          : {}),
        ...(verifyDetail ? { detail: verifyDetail } : {}),
      },
      apply: {
        status: applyStatus,
        ...(typeof applyDurationMs === "number"
          ? { durationMs: applyDurationMs }
          : {}),
        ...(applyAgentId ? { agentId: applyAgentId } : {}),
        ...(normalizedApplyDetail ? { detail: normalizedApplyDetail } : {}),
      },
    },
    events,
  };
}

function assertAutoOptionCompatibility(options: ExecuteAutoCommandInput): void {
  validateAutoCommandOptions(options);
}

function resolveAutoTerminalStatus(options: {
  hardFailure: boolean;
  hardAbort: boolean;
  actionRequired: boolean;
}): AutoTerminalStatus {
  if (options.hardAbort) {
    return "aborted";
  }
  if (options.hardFailure) {
    return "failed";
  }
  if (options.actionRequired) {
    return "action_required";
  }
  return "succeeded";
}

function mapAutoTerminalStatusToExitCode(status: AutoTerminalStatus): number {
  if (status === "succeeded") {
    return 0;
  }
  if (status === "aborted") {
    return 3;
  }
  return 1;
}

function truncateOutcomeDetail(detail?: string): string | undefined {
  if (!detail) {
    return undefined;
  }
  const trimmed = detail.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
}

function resolveAutoTerminalDetail(options: {
  status: AutoTerminalStatus;
  actionRequiredDetail?: string;
  applyDetail?: string;
  verifyDetail?: string;
  runDetail?: string;
  specDetail?: string;
}): string | undefined {
  if (options.status === "action_required") {
    return truncateOutcomeDetail(
      options.actionRequiredDetail ?? options.applyDetail,
    );
  }

  if (options.status === "failed") {
    return truncateOutcomeDetail(
      options.applyDetail ??
        options.verifyDetail ??
        options.runDetail ??
        options.specDetail,
    );
  }

  if (options.status === "aborted") {
    return truncateOutcomeDetail(options.runDetail ?? options.verifyDetail);
  }

  return undefined;
}

function toHeadline(error: unknown): string {
  return error instanceof HintedError ? error.headline : toErrorMessage(error);
}

function applyAutoVerificationSelectionDisposition(options: {
  disposition: AutoVerificationSelectionDisposition;
  onVerifyDetail: (detail: string) => void;
  onActionRequired: (detail: string) => void;
}): void {
  const { disposition, onVerifyDetail, onActionRequired } = options;

  switch (disposition.kind) {
    case "proceed":
      return;
    case "action_required":
      onVerifyDetail(disposition.detail);
      onActionRequired(disposition.detail);
      return;
  }
}
