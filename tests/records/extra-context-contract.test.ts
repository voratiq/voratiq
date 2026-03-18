import { describe, expect, it } from "@jest/globals";

import { reductionRecordSchema } from "../../src/domains/reductions/model/types.js";
import { reviewRecordSchema } from "../../src/domains/reviews/model/types.js";
import { runRecordSchema } from "../../src/domains/runs/model/types.js";
import { specRecordSchema } from "../../src/domains/specs/model/types.js";
import { buildPersistedExtraContextFields } from "../../src/extra-context/contract.js";

const persistedExtraContext = buildPersistedExtraContextFields([
  {
    displayPath: "/tmp/carry-forward.md",
    stagedRelativePath: "../context/carry-forward.md",
  },
]);

describe("persisted extra-context contract", () => {
  it("emits staged paths as the canonical record contract plus separate provenance metadata", () => {
    expect(persistedExtraContext).toEqual({
      extraContext: ["../context/carry-forward.md"],
      extraContextMetadata: [
        {
          stagedPath: "../context/carry-forward.md",
          sourcePath: "/tmp/carry-forward.md",
        },
      ],
    });
  });

  it("parses the same staged contract across spec, run, review, and reduce records", () => {
    expect(() =>
      specRecordSchema.parse({
        sessionId: "spec-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        status: "running",
        description: "Spec",
        agents: [
          {
            agentId: "alpha",
            status: "running",
            startedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        ...persistedExtraContext,
      }),
    ).not.toThrow();

    expect(() =>
      runRecordSchema.parse({
        runId: "run-123",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        agents: [],
        deletedAt: null,
        ...persistedExtraContext,
      }),
    ).not.toThrow();

    expect(() =>
      reviewRecordSchema.parse({
        sessionId: "review-123",
        runId: "run-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
        reviewers: [
          {
            agentId: "reviewer",
            status: "running",
            outputPath:
              ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
            startedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        ...persistedExtraContext,
      }),
    ).not.toThrow();

    expect(() =>
      reductionRecordSchema.parse({
        sessionId: "reduce-123",
        target: { type: "spec", id: "spec-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
        reducers: [
          {
            agentId: "reducer",
            status: "running",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/reducer/artifacts/reduction.md",
            startedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        ...persistedExtraContext,
      }),
    ).not.toThrow();
  });

  it("requires staged paths inside provenance metadata for all operator records", () => {
    const invalidMetadata = {
      extraContext: ["../context/carry-forward.md"],
      extraContextMetadata: [
        {
          stagedPath: "notes/carry-forward.md",
          sourcePath: "/tmp/carry-forward.md",
        },
      ],
    };

    expect(() =>
      specRecordSchema.parse({
        sessionId: "spec-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        status: "running",
        description: "Spec",
        agents: [
          {
            agentId: "alpha",
            status: "running",
            startedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        ...invalidMetadata,
      }),
    ).toThrow(/context/u);

    expect(() =>
      runRecordSchema.parse({
        runId: "run-123",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        agents: [],
        deletedAt: null,
        ...invalidMetadata,
      }),
    ).toThrow(/context/u);

    expect(() =>
      reviewRecordSchema.parse({
        sessionId: "review-123",
        runId: "run-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
        reviewers: [
          {
            agentId: "reviewer",
            status: "running",
            outputPath:
              ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
            startedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        ...invalidMetadata,
      }),
    ).toThrow(/context/u);

    expect(() =>
      reductionRecordSchema.parse({
        sessionId: "reduce-123",
        target: { type: "spec", id: "spec-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
        reducers: [
          {
            agentId: "reducer",
            status: "running",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/reducer/artifacts/reduction.md",
            startedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        ...invalidMetadata,
      }),
    ).toThrow(/context/u);
  });
});
