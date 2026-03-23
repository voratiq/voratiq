export type StageRendererId = "run" | "verify" | "spec" | "reduce";

export type StageProgressStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "errored"
  | "aborted"
  | "skipped"
  | "pruned";

export interface StageProgressBeginEvent<TContext extends object> {
  type: "stage.begin";
  stage: StageRendererId;
  context: TContext;
}

export interface StageProgressCandidateEvent<TCandidate extends object> {
  type: "stage.candidate";
  stage: StageRendererId;
  candidate: TCandidate;
}

export interface StageProgressStatusEvent {
  type: "stage.status";
  stage: StageRendererId;
  status: StageProgressStatus;
}

export type StageProgressEvent<
  TContext extends object,
  TCandidate extends object,
> =
  | StageProgressBeginEvent<TContext>
  | StageProgressCandidateEvent<TCandidate>
  | StageProgressStatusEvent;

export interface StageProgressEventConsumer<
  TContext extends object,
  TCandidate extends object,
> {
  onProgressEvent(event: StageProgressEvent<TContext, TCandidate>): void;
}

export function emitStageProgressEvent<
  TContext extends object,
  TCandidate extends object,
>(
  consumer: StageProgressEventConsumer<TContext, TCandidate> | undefined,
  event: StageProgressEvent<TContext, TCandidate>,
): void {
  if (!consumer) {
    return;
  }
  consumer.onProgressEvent(event);
}
