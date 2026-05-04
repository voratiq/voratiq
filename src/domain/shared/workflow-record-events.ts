import type { MessageRecord } from "../message/model/types.js";
import type { ReductionRecord } from "../reduce/model/types.js";
import type { RunRecord } from "../run/model/types.js";
import type { SpecRecord } from "../spec/model/types.js";
import type { VerificationRecord } from "../verify/model/types.js";

export type PersistedWorkflowRecordEvent =
  | {
      operator: "message";
      root: string;
      record: MessageRecord;
      recordUpdatedAt: string;
      env?: NodeJS.ProcessEnv;
    }
  | {
      operator: "reduce";
      root: string;
      record: ReductionRecord;
      recordUpdatedAt: string;
      env?: NodeJS.ProcessEnv;
    }
  | {
      operator: "run";
      root: string;
      record: RunRecord;
      recordUpdatedAt: string;
      env?: NodeJS.ProcessEnv;
    }
  | {
      operator: "spec";
      root: string;
      record: SpecRecord;
      recordUpdatedAt: string;
      env?: NodeJS.ProcessEnv;
    }
  | {
      operator: "verify";
      root: string;
      record: VerificationRecord;
      recordUpdatedAt: string;
      env?: NodeJS.ProcessEnv;
    };

export type PersistedWorkflowRecordSubscriber = (
  event: PersistedWorkflowRecordEvent,
) => void | Promise<void>;

const persistedWorkflowRecordSubscribers =
  new Set<PersistedWorkflowRecordSubscriber>();

export function subscribePersistedWorkflowRecordEvents(
  subscriber: PersistedWorkflowRecordSubscriber,
): () => void {
  persistedWorkflowRecordSubscribers.add(subscriber);
  return () => {
    persistedWorkflowRecordSubscribers.delete(subscriber);
  };
}

export async function emitPersistedWorkflowRecordEvent(
  event: PersistedWorkflowRecordEvent,
): Promise<void> {
  for (const subscriber of persistedWorkflowRecordSubscribers) {
    await subscriber(event);
  }
}
