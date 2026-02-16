import { describe } from "@jest/globals";

import { executeCompetitionWithAdapter } from "../../src/competition/command-adapter.js";
import {
  type AdapterContractScenarioInput,
  type AdapterContractSubject,
  defineCompetitionCommandAdapterContract,
} from "./command-adapter-contract.js";

interface ContractResult {
  readonly id: string;
  readonly status: "succeeded" | "failed";
  readonly reason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const subject: AdapterContractSubject<ContractResult> = {
  run: async ({
    candidates,
    maxParallel,
    failurePolicy,
    failingCandidates,
    captureFailures,
    delaysMsByCandidateId,
    sortResults,
    throwFinalizeError,
    events,
  }: AdapterContractScenarioInput<ContractResult>) =>
    await executeCompetitionWithAdapter<string, string, ContractResult>({
      candidates,
      maxParallel,
      adapter: {
        failurePolicy,
        prepareCandidates: (queued) => ({
          ready: queued,
          failures: [],
        }),
        executeCandidate: async (candidate) => {
          events.push(`execute:${candidate}`);
          const delay = delaysMsByCandidateId?.[candidate] ?? 0;
          if (delay > 0) {
            await sleep(delay);
          }
          if (failingCandidates?.has(candidate)) {
            throw new Error(`execution failure for ${candidate}`);
          }
          return {
            id: candidate,
            status: "succeeded",
          };
        },
        captureExecutionFailure: captureFailures
          ? ({ prepared, error }) => ({
              id: prepared,
              status: "failed",
              reason: error instanceof Error ? error.message : String(error),
            })
          : undefined,
        cleanupPreparedCandidate: (candidate) => {
          events.push(`cleanup:${candidate}`);
        },
        finalizeCompetition: () => {
          events.push("finalize");
          if (throwFinalizeError) {
            throw new Error("finalize failure");
          }
        },
        sortResults,
      },
    }),
  getResultId: (result) => result.id,
  getResultStatus: (result) => result.status,
};

describe("competition command adapter contract", () => {
  defineCompetitionCommandAdapterContract(subject);
});
