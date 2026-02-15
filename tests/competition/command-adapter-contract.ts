/* eslint-disable jest/no-export */
import { expect, it } from "@jest/globals";

import type { CompetitionFailurePolicy } from "../../src/competition/command-adapter.js";

export interface AdapterContractScenarioInput<TResult> {
  readonly candidates: readonly string[];
  readonly maxParallel: number;
  readonly failurePolicy?: CompetitionFailurePolicy;
  readonly failingCandidates?: ReadonlySet<string>;
  readonly captureFailures?: boolean;
  readonly delaysMsByCandidateId?: Readonly<Record<string, number>>;
  readonly sortResults?: (left: TResult, right: TResult) => number;
  readonly throwFinalizeError?: boolean;
  readonly events: string[];
}

export interface AdapterContractSubject<TResult> {
  run(input: AdapterContractScenarioInput<TResult>): Promise<TResult[]>;
  getResultId(result: TResult): string;
  getResultStatus(result: TResult): "succeeded" | "failed";
}

export function defineCompetitionCommandAdapterContract<TResult>(
  subject: AdapterContractSubject<TResult>,
): void {
  it("supports deterministic collation with a comparator", async () => {
    const results = await subject.run({
      candidates: ["beta", "alpha", "gamma"],
      maxParallel: 3,
      delaysMsByCandidateId: {
        beta: 25,
        alpha: 5,
        gamma: 15,
      },
      sortResults: (left, right) =>
        subject.getResultId(left).localeCompare(subject.getResultId(right)),
      events: [],
    });

    expect(results.map((result) => subject.getResultId(result))).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("enforces continue-vs-abort failure policy semantics", async () => {
    const continueEvents: string[] = [];
    await expect(
      subject.run({
        candidates: ["a", "b", "c"],
        maxParallel: 1,
        failurePolicy: "continue",
        failingCandidates: new Set(["b"]),
        events: continueEvents,
      }),
    ).rejects.toThrow("execution failure for b");

    const abortEvents: string[] = [];
    await expect(
      subject.run({
        candidates: ["a", "b", "c"],
        maxParallel: 1,
        failurePolicy: "abort",
        failingCandidates: new Set(["b"]),
        events: abortEvents,
      }),
    ).rejects.toThrow("execution failure for b");

    const continuedExecutions = continueEvents.filter((event) =>
      event.startsWith("execute:"),
    );
    const abortedExecutions = abortEvents.filter((event) =>
      event.startsWith("execute:"),
    );

    expect(continuedExecutions).toEqual([
      "execute:a",
      "execute:b",
      "execute:c",
    ]);
    expect(abortedExecutions).toEqual(["execute:a", "execute:b"]);
  });

  it("guarantees per-candidate cleanup even when execution aborts", async () => {
    const events: string[] = [];
    await expect(
      subject.run({
        candidates: ["a", "b", "c"],
        maxParallel: 1,
        failurePolicy: "abort",
        failingCandidates: new Set(["b"]),
        events,
      }),
    ).rejects.toThrow("execution failure for b");

    const cleanupEvents = events.filter((event) =>
      event.startsWith("cleanup:"),
    );
    expect(cleanupEvents).toEqual(["cleanup:a", "cleanup:b", "cleanup:c"]);
  });

  it("runs finalization on error paths", async () => {
    const events: string[] = [];
    await expect(
      subject.run({
        candidates: ["a", "b", "c"],
        maxParallel: 1,
        failurePolicy: "abort",
        failingCandidates: new Set(["b"]),
        throwFinalizeError: true,
        events,
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(events.filter((event) => event === "finalize")).toEqual([
      "finalize",
    ]);
  });

  it("allows adapters to continue by capturing execution failures", async () => {
    const results = await subject.run({
      candidates: ["a", "b", "c"],
      maxParallel: 2,
      failurePolicy: "continue",
      captureFailures: true,
      failingCandidates: new Set(["b"]),
      sortResults: (left, right) =>
        subject.getResultId(left).localeCompare(subject.getResultId(right)),
      events: [],
    });

    expect(
      results.map((result) => ({
        id: subject.getResultId(result),
        status: subject.getResultStatus(result),
      })),
    ).toEqual([
      { id: "a", status: "succeeded" },
      { id: "b", status: "failed" },
      { id: "c", status: "succeeded" },
    ]);
  });
}
