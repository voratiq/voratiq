import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type TranscriptShellModule =
  typeof import("../../../src/render/utils/transcript-shell.js");

jest.mock("../../../src/render/utils/transcript-shell.js", () => {
  const actual: TranscriptShellModule = jest.requireActual(
    "../../../src/render/utils/transcript-shell.js",
  );
  return {
    ...actual,
    buildTranscriptShellSection: jest.fn(actual.buildTranscriptShellSection),
  };
});

import { renderReviewTranscript } from "../../../src/render/transcripts/review.js";
import { buildRunMetadataSectionWithStyle } from "../../../src/render/utils/runs.js";
import { buildTranscriptShellSection } from "../../../src/render/utils/transcript-shell.js";

const buildTranscriptShellSectionMock =
  buildTranscriptShellSection as jest.MockedFunction<
    typeof buildTranscriptShellSection
  >;

describe("shared transcript shell helpers", () => {
  beforeEach(() => {
    buildTranscriptShellSectionMock.mockClear();
  });

  it("renders run metadata via buildTranscriptShellSection", () => {
    buildRunMetadataSectionWithStyle(
      {
        runId: "run-123",
        status: "running",
        specPath: "spec.md",
        workspacePath: ".voratiq/runs/sessions/run-123",
        elapsed: "10s",
        createdAt: "2026-01-01T00:00:00.000Z",
        baseRevisionSha: "abc123",
      },
      { isTty: false },
    );

    expect(buildTranscriptShellSectionMock).toHaveBeenCalledTimes(1);
  });

  it("renders review header via buildTranscriptShellSection", () => {
    renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "10s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "running",
      reviewers: [],
      suppressHint: true,
      isTty: false,
    });

    expect(buildTranscriptShellSectionMock).toHaveBeenCalledTimes(1);
  });
});
