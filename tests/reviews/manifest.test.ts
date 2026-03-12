import { describe, expect, it } from "@jest/globals";

import { buildBlindedReviewManifest } from "../../src/domains/reviews/competition/manifest.js";
import { buildRunRecordEnhanced } from "../../src/domains/runs/model/enhanced.js";
import type { RunRecord } from "../../src/domains/runs/model/types.js";
import { createRunRecord } from "../support/factories/run-records.js";

describe("buildBlindedReviewManifest", () => {
  it("uses the canonical run completedAt timestamp", async () => {
    const completedAt = "2026-01-01T00:05:00.000Z";
    const run = buildRunRecordEnhanced(
      createRunRecord({
        status: "succeeded",
        completedAt,
      }),
    );

    const { manifest } = await buildBlindedReviewManifest({
      root: "/repo",
      run,
      specPath: ".voratiq/specs/spec.md",
      candidates: [],
      baseSnapshotPath: ".voratiq/reviews/base",
    });

    expect(manifest.run.completedAt).toBe(completedAt);
  });

  it("rejects terminal runs that are missing canonical completedAt", async () => {
    const invalidRun = {
      ...createRunRecord({
        status: "succeeded",
      }),
      completedAt: undefined,
    } as unknown as RunRecord;
    const run = buildRunRecordEnhanced(invalidRun);

    await expect(
      buildBlindedReviewManifest({
        root: "/repo",
        run,
        specPath: ".voratiq/specs/spec.md",
        candidates: [],
        baseSnapshotPath: ".voratiq/reviews/base",
      }),
    ).rejects.toThrow(/missing canonical completedAt/u);
  });
});
