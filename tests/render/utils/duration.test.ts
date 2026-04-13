import { describe, expect, it } from "@jest/globals";

import {
  formatRenderLifecycleDuration,
  formatRenderLifecycleRowDuration,
} from "../../../src/render/utils/duration.js";

describe("render lifecycle duration helpers", () => {
  it("keeps session-level elapsed running-so-far", () => {
    expect(
      formatRenderLifecycleDuration({
        lifecycle: {
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
        terminalStatuses: ["succeeded", "failed"],
        now: Date.parse("2026-01-01T00:00:05.000Z"),
      }),
    ).toBe("5s");
  });

  it.each([
    {
      title: "queued",
      lifecycle: {
        status: "queued" as const,
      },
    },
    {
      title: "running",
      lifecycle: {
        status: "running" as const,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      title: "terminal without completedAt",
      lifecycle: {
        status: "succeeded" as const,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ])("renders $title rows as an em dash", ({ lifecycle }) => {
    expect(
      formatRenderLifecycleRowDuration({
        lifecycle,
        terminalStatuses: ["succeeded", "failed"],
        now: Date.parse("2026-01-01T00:00:05.000Z"),
      }),
    ).toBe("—");
  });

  it("formats terminal rows with completed durations", () => {
    expect(
      formatRenderLifecycleRowDuration({
        lifecycle: {
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
        },
        terminalStatuses: ["succeeded", "failed"],
      }),
    ).toBe("1m");
  });
});
