import { describe, expect, it, jest } from "@jest/globals";

import {
  executeCompetition,
  runPreparedWithLimit,
} from "../../src/competition/core.js";

interface Candidate {
  id: string;
}

interface CompetitionResult {
  id: string;
  status: "succeeded" | "failed";
  reason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("competition core", () => {
  it("runs prepared entries in parallel while preserving input result ordering", async () => {
    const prepared = ["alpha", "beta", "gamma"] as const;
    const completionOrder: string[] = [];
    const delaysById: Record<string, number> = {
      alpha: 25,
      beta: 5,
      gamma: 15,
    };

    const results = await runPreparedWithLimit({
      prepared,
      maxParallel: 3,
      executePrepared: async (entry) => {
        await sleep(delaysById[entry]);
        completionOrder.push(entry);
        return entry;
      },
    });

    expect(completionOrder).toEqual(["beta", "gamma", "alpha"]);
    expect(results).toEqual(["alpha", "beta", "gamma"]);
  });

  it("captures execution failures and continues through all prepared entries", async () => {
    const prepared = ["one", "two", "three"] as const;
    const executed: string[] = [];
    const cleaned: string[] = [];
    type PreparedResult = {
      id: (typeof prepared)[number];
      status: "succeeded" | "failed";
      reason?: string;
    };

    const results = await runPreparedWithLimit<
      (typeof prepared)[number],
      PreparedResult
    >({
      prepared,
      maxParallel: 2,
      failurePolicy: "continue",
      executePrepared: (entry) => {
        executed.push(entry);
        if (entry === "two") {
          throw new Error("boom");
        }
        return { id: entry, status: "succeeded" };
      },
      onExecutionFailure: ({ prepared: entry, error }) => ({
        id: entry,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      }),
      cleanupPrepared: (entry) => {
        cleaned.push(entry);
      },
    });

    expect(results).toEqual([
      { id: "one", status: "succeeded" },
      { id: "two", status: "failed", reason: "boom" },
      { id: "three", status: "succeeded" },
    ]);
    expect(executed).toEqual(expect.arrayContaining(["one", "two", "three"]));
    expect(cleaned).toEqual(expect.arrayContaining(["one", "two", "three"]));
    expect(cleaned).toHaveLength(3);
  });

  it("produces deterministic result ordering with an explicit comparator", async () => {
    const candidates: Candidate[] = [
      { id: "beta" },
      { id: "alpha" },
      { id: "gamma" },
    ];
    const completionOrder: string[] = [];

    const delaysById: Record<string, number> = {
      beta: 25,
      alpha: 5,
      gamma: 15,
    };

    const results = await executeCompetition<
      Candidate,
      Candidate,
      CompetitionResult
    >({
      candidates,
      maxParallel: 3,
      prepareCandidates: (queued) => ({
        ready: queued,
        failures: [],
      }),
      executePreparedCandidate: async (candidate) => {
        await sleep(delaysById[candidate.id] ?? 0);
        completionOrder.push(candidate.id);
        return {
          id: candidate.id,
          status: "succeeded",
        };
      },
      sortResults: (left, right) => left.id.localeCompare(right.id),
    });

    expect(completionOrder).toEqual(["alpha", "gamma", "beta"]);
    expect(results.map((result) => result.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("continues competition execution when failures are captured", async () => {
    const candidates: Candidate[] = [{ id: "a" }, { id: "b" }, { id: "c" }];

    const results = await executeCompetition<
      Candidate,
      Candidate,
      CompetitionResult
    >({
      candidates,
      maxParallel: 2,
      failurePolicy: "continue",
      prepareCandidates: (queued) => ({
        ready: queued,
        failures: [],
      }),
      executePreparedCandidate: (candidate) => {
        if (candidate.id === "b") {
          throw new Error("simulated failure");
        }

        return {
          id: candidate.id,
          status: "succeeded",
        };
      },
      captureExecutionFailure: ({ prepared, error }) => ({
        id: prepared.id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      }),
      sortResults: (left, right) => left.id.localeCompare(right.id),
    });

    expect(results).toEqual([
      { id: "a", status: "succeeded" },
      { id: "b", status: "failed", reason: "simulated failure" },
      { id: "c", status: "succeeded" },
    ]);
  });

  it("runs per-candidate cleanup and finalization even when execution aborts", async () => {
    const candidates: Candidate[] = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ];
    const executed: string[] = [];
    const cleaned: string[] = [];
    const finalizeCompetition = jest.fn(() => Promise.resolve());

    await expect(
      executeCompetition<Candidate, Candidate, CompetitionResult>({
        candidates,
        maxParallel: 1,
        failurePolicy: "abort",
        prepareCandidates: (queued) => ({
          ready: queued,
          failures: [],
        }),
        executePreparedCandidate: (candidate) => {
          executed.push(candidate.id);
          if (candidate.id === "first") {
            throw new Error("abort now");
          }

          return {
            id: candidate.id,
            status: "succeeded",
          };
        },
        cleanupPreparedCandidate: (candidate) => {
          cleaned.push(candidate.id);
        },
        finalizeCompetition,
      }),
    ).rejects.toThrow("abort now");

    expect(executed).toEqual(["first"]);
    expect(cleaned).toEqual(["first", "second", "third"]);
    expect(finalizeCompetition).toHaveBeenCalledTimes(1);
  });
});
