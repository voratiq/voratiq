import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type TranscriptShellModule =
  typeof import("../../../src/render/utils/transcript-shell.js");

jest.mock("../../../src/render/utils/transcript-shell.js", () => {
  const actual: TranscriptShellModule = jest.requireActual(
    "../../../src/render/utils/transcript-shell.js",
  );
  return {
    ...actual,
    buildStandardSessionShellSection: jest.fn(
      actual.buildStandardSessionShellSection,
    ),
  };
});

import { renderVerifyTranscript } from "../../../src/render/transcripts/verify.js";
import { buildRunMetadataSectionWithStyle } from "../../../src/render/utils/runs.js";
import { buildStandardSessionShellSection } from "../../../src/render/utils/transcript-shell.js";

const buildStandardSessionShellSectionMock =
  buildStandardSessionShellSection as jest.MockedFunction<
    typeof buildStandardSessionShellSection
  >;

describe("shared transcript shell helpers", () => {
  beforeEach(() => {
    buildStandardSessionShellSectionMock.mockClear();
  });

  it("renders run metadata via buildStandardSessionShellSection", () => {
    buildRunMetadataSectionWithStyle(
      {
        runId: "run-123",
        status: "running",
        workspacePath: ".voratiq/run/sessions/run-123",
        elapsed: "10s",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { isTty: false },
    );

    expect(buildStandardSessionShellSectionMock).toHaveBeenCalledTimes(1);
  });

  it("renders verify header via buildStandardSessionShellSection", () => {
    renderVerifyTranscript({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "10s",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      status: "running",
      methods: [],
      suppressHint: true,
      isTty: false,
    });

    expect(buildStandardSessionShellSectionMock).toHaveBeenCalledTimes(1);
  });
});
