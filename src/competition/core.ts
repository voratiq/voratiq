type Awaitable<T> = Promise<T> | T;

export type CompetitionFailurePolicy = "abort" | "continue";

export interface CompetitionPreparationResult<TPrepared, TResult> {
  readonly ready: readonly TPrepared[];
  readonly failures: readonly TResult[];
}

export interface CompetitionExecuteFailureContext<TPrepared> {
  readonly stage: "execute";
  readonly prepared: TPrepared;
  readonly index: number;
  readonly error: unknown;
}

export interface BoundedCompetitionExecutionInput<TPrepared, TResult> {
  readonly prepared: readonly TPrepared[];
  readonly maxParallel: number;
  readonly executePrepared: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<TResult>;
  readonly onPreparedRunning?: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<void>;
  readonly onPreparedCompleted?: (
    prepared: TPrepared,
    result: TResult,
    index: number,
  ) => Awaitable<void>;
  readonly onExecutionFailure?: (
    context: CompetitionExecuteFailureContext<TPrepared>,
  ) => Awaitable<TResult | undefined>;
  readonly cleanupPrepared?: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<void>;
  readonly failurePolicy?: CompetitionFailurePolicy;
}

export interface CompetitionExecutionInput<TCandidate, TPrepared, TResult> {
  readonly candidates: readonly TCandidate[];
  readonly maxParallel: number;
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
  readonly onPreparedCandidate?: (
    prepared: TPrepared,
    index: number,
  ) => Awaitable<void>;
  readonly executePreparedCandidate: (
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
  readonly failurePolicy?: CompetitionFailurePolicy;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface ErrorState {
  primary: Error | undefined;
  secondary: Error[];
}

function pushError(state: ErrorState, error: unknown): void {
  const normalized = toError(error);
  if (!state.primary) {
    state.primary = normalized;
    return;
  }
  state.secondary.push(normalized);
}

function throwCollectedErrors(state: ErrorState): never {
  if (state.primary && state.secondary.length > 0) {
    throw new AggregateError(
      [state.primary, ...state.secondary],
      state.primary.message,
    );
  }

  if (state.primary) {
    throw state.primary;
  }

  throw new Error("Competition execution failed without a captured error");
}

export async function runPreparedWithLimit<TPrepared, TResult>(
  input: BoundedCompetitionExecutionInput<TPrepared, TResult>,
): Promise<TResult[]> {
  const {
    prepared,
    maxParallel,
    executePrepared,
    onPreparedRunning,
    onPreparedCompleted,
    onExecutionFailure,
    cleanupPrepared,
    failurePolicy = "abort",
  } = input;

  if (prepared.length === 0) {
    return [];
  }

  if (maxParallel <= 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(maxParallel, prepared.length));
  const results = new Array<TResult | undefined>(prepared.length);
  const started = new Set<number>();
  const cleaned = new Set<number>();
  const errors: ErrorState = {
    primary: undefined,
    secondary: [],
  };
  let nextIndex = 0;
  let shouldStop = false;

  async function runCleanup(index: number): Promise<void> {
    if (cleaned.has(index)) {
      return;
    }
    cleaned.add(index);
    if (!cleanupPrepared) {
      return;
    }
    await cleanupPrepared(prepared[index], index);
  }

  async function worker(): Promise<void> {
    while (true) {
      if (shouldStop && failurePolicy === "abort") {
        return;
      }

      const current = nextIndex++;
      if (current >= prepared.length) {
        return;
      }

      started.add(current);
      const entry = prepared[current];

      try {
        if (onPreparedRunning) {
          await onPreparedRunning(entry, current);
        }

        const result = await executePrepared(entry, current);
        results[current] = result;

        if (onPreparedCompleted) {
          await onPreparedCompleted(entry, result, current);
        }
      } catch (error) {
        const context: CompetitionExecuteFailureContext<TPrepared> = {
          stage: "execute",
          prepared: entry,
          index: current,
          error,
        };

        let captured: TResult | undefined;
        if (onExecutionFailure) {
          captured = await onExecutionFailure(context);
        }

        if (captured !== undefined) {
          results[current] = captured;
        } else if (failurePolicy === "continue") {
          pushError(errors, error);
        } else {
          shouldStop = true;
          pushError(errors, error);
        }
      } finally {
        try {
          await runCleanup(current);
        } catch (error) {
          pushError(errors, error);
          if (failurePolicy === "abort") {
            shouldStop = true;
          }
        }
      }
    }
  }

  const workers = new Array<Promise<void>>(workerCount);
  for (let index = 0; index < workerCount; index += 1) {
    workers[index] = worker();
  }
  await Promise.all(workers);

  for (let index = 0; index < prepared.length; index += 1) {
    if (!started.has(index) || !cleaned.has(index)) {
      try {
        await runCleanup(index);
      } catch (error) {
        pushError(errors, error);
      }
    }
  }

  if (errors.primary) {
    throwCollectedErrors(errors);
  }

  return results.filter((result): result is TResult => result !== undefined);
}

export async function executeCompetition<TCandidate, TPrepared, TResult>(
  input: CompetitionExecutionInput<TCandidate, TPrepared, TResult>,
): Promise<TResult[]> {
  const {
    candidates,
    maxParallel,
    queueCandidate,
    prepareCandidates,
    onPreparationFailure,
    onPreparedCandidate,
    executePreparedCandidate,
    onCandidateRunning,
    onCandidateCompleted,
    captureExecutionFailure,
    cleanupPreparedCandidate,
    finalizeCompetition,
    sortResults,
    failurePolicy = "abort",
  } = input;

  const errors: ErrorState = {
    primary: undefined,
    secondary: [],
  };
  let results: TResult[] = [];

  try {
    for (const [index, candidate] of candidates.entries()) {
      if (queueCandidate) {
        await queueCandidate(candidate, index);
      }
    }

    const preparation = await prepareCandidates(candidates);

    for (const [index, failure] of preparation.failures.entries()) {
      if (onPreparationFailure) {
        await onPreparationFailure(failure, index);
      }
    }

    for (const [index, preparedCandidate] of preparation.ready.entries()) {
      if (onPreparedCandidate) {
        await onPreparedCandidate(preparedCandidate, index);
      }
    }

    const executionResults = await runPreparedWithLimit({
      prepared: preparation.ready,
      maxParallel,
      executePrepared: executePreparedCandidate,
      onPreparedRunning: onCandidateRunning,
      onPreparedCompleted: onCandidateCompleted,
      onExecutionFailure: captureExecutionFailure,
      cleanupPrepared: cleanupPreparedCandidate,
      failurePolicy,
    });

    results = [...preparation.failures, ...executionResults];
    if (sortResults) {
      results = [...results].sort(sortResults);
    }
  } catch (error) {
    pushError(errors, error);
  } finally {
    if (finalizeCompetition) {
      try {
        await finalizeCompetition();
      } catch (error) {
        pushError(errors, error);
      }
    }
  }

  if (errors.primary) {
    throwCollectedErrors(errors);
  }

  return results;
}
