import {
  type CompetitionExecuteFailureContext,
  type CompetitionFailurePolicy,
  type CompetitionPreparationResult,
  executeCompetition,
} from "./core.js";

type Awaitable<T> = Promise<T> | T;

/**
 * Shared command adapter contract for competition-core orchestration.
 *
 * Lifecycle order:
 * 1. `queueCandidate` (per input candidate)
 * 2. `prepareCandidates`
 * 3. `onPreparationFailure` (per preparation failure result)
 * 4. `onCandidatePrepared` (per prepared candidate)
 * 5. execution phase (`onCandidateRunning` -> `executeCandidate` -> `onCandidateCompleted`)
 * 6. `cleanupPreparedCandidate` (once per prepared candidate, including abort/error paths)
 * 7. `finalizeCompetition` (exactly once, including error paths)
 */
export interface CompetitionCommandAdapter<TCandidate, TPrepared, TResult> {
  readonly failurePolicy?: CompetitionFailurePolicy;
  readonly queueCandidate?: (
    candidate: TCandidate,
    index: number,
  ) => Awaitable<void>;
  readonly prepareCandidates: (
    candidates: readonly TCandidate[],
  ) => Awaitable<CompetitionPreparationResult<TPrepared, TResult>>;
  readonly onPreparationFailure?: (
    result: TResult,
    index: number,
  ) => Awaitable<void>;
  readonly onCandidatePrepared?: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<void>;
  readonly executeCandidate: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<TResult>;
  readonly onCandidateRunning?: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<void>;
  readonly onCandidateCompleted?: (
    prepared: TPrepared,
    result: TResult,
    index: number,
  ) => Awaitable<void>;
  readonly captureExecutionFailure?: (
    context: CompetitionExecuteFailureContext<TPrepared>,
  ) => Awaitable<TResult | undefined>;
  readonly cleanupPreparedCandidate?: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<void>;
  readonly finalizeCompetition?: () => Awaitable<void>;
  readonly sortResults?: (left: TResult, right: TResult) => number;
}

export interface ExecuteCompetitionCommandInput<
  TCandidate,
  TPrepared,
  TResult,
> {
  readonly candidates: readonly TCandidate[];
  readonly maxParallel: number;
  readonly adapter: CompetitionCommandAdapter<TCandidate, TPrepared, TResult>;
}

export async function executeCompetitionWithAdapter<
  TCandidate,
  TPrepared,
  TResult,
>(
  input: ExecuteCompetitionCommandInput<TCandidate, TPrepared, TResult>,
): Promise<TResult[]> {
  const { candidates, maxParallel, adapter } = input;

  return await executeCompetition({
    candidates,
    maxParallel,
    queueCandidate: adapter.queueCandidate,
    prepareCandidates: adapter.prepareCandidates,
    onPreparationFailure: adapter.onPreparationFailure,
    onPreparedCandidate: adapter.onCandidatePrepared,
    executePreparedCandidate: adapter.executeCandidate,
    onCandidateRunning: adapter.onCandidateRunning,
    onCandidateCompleted: adapter.onCandidateCompleted,
    captureExecutionFailure: adapter.captureExecutionFailure,
    cleanupPreparedCandidate: adapter.cleanupPreparedCandidate,
    finalizeCompetition: adapter.finalizeCompetition,
    sortResults: adapter.sortResults,
    failurePolicy: adapter.failurePolicy,
  });
}

export type {
  CompetitionExecuteFailureContext,
  CompetitionFailurePolicy,
  CompetitionPreparationResult,
};
