import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type StageOutputModule =
  typeof import("../../../src/render/utils/stage-output.js");

jest.mock("../../../src/render/utils/stage-output.js", () => {
  const actual: StageOutputModule = jest.requireActual(
    "../../../src/render/utils/stage-output.js",
  );
  return {
    ...actual,
    renderStageFinalFrame: jest.fn(actual.renderStageFinalFrame),
    buildStageFrameSections: jest.fn(actual.buildStageFrameSections),
  };
});

import { renderReviewTranscript } from "../../../src/render/transcripts/review.js";
import { createRunRenderer } from "../../../src/render/transcripts/run.js";
import { renderSpecTranscript } from "../../../src/render/transcripts/spec.js";
import {
  buildStageFrameSections,
  renderStageFinalFrame,
} from "../../../src/render/utils/stage-output.js";
import { createRunReport } from "../../support/factories/run-records.js";

const renderStageFinalFrameMock = renderStageFinalFrame as jest.MockedFunction<
  typeof renderStageFinalFrame
>;
const buildStageFrameSectionsMock =
  buildStageFrameSections as jest.MockedFunction<
    typeof buildStageFrameSections
  >;

function createAgentReport(status: "succeeded" | "failed" | "aborted") {
  return {
    agentId: "runner",
    status,
    runtimeManifestPath: "runtime.json",
    baseDirectory: "base",
    assets: {},
    evals: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    diffAttempted: true,
    diffCaptured: true,
  };
}

describe("stage output adapters", () => {
  beforeEach(() => {
    renderStageFinalFrameMock.mockClear();
    buildStageFrameSectionsMock.mockClear();
  });

  it("run adapter passes stage frame data to renderStageFinalFrame", () => {
    const renderer = createRunRenderer({
      stdout: {
        isTTY: false,
        write: () => true,
      },
    });

    renderer.begin({
      runId: "run-123",
      status: "running",
      specPath: "specs/test.md",
      workspacePath: ".voratiq/runs/sessions/run-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      baseRevisionSha: "abc123",
    });

    renderer.complete(
      createRunReport({
        runId: "run-123",
        status: "succeeded",
        spec: { path: "specs/test.md" },
        createdAt: "2026-01-01T00:00:00.000Z",
        baseRevisionSha: "abc123",
        agents: [createAgentReport("succeeded")],
      }),
    );

    expect(renderStageFinalFrameMock).toHaveBeenCalledTimes(1);
    expect(renderStageFinalFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataLines: expect.arrayContaining(["run-123 SUCCEEDED"]),
        statusTableLines: expect.arrayContaining([
          expect.stringContaining("AGENT"),
        ]),
      }),
    );
  });

  it("review adapter builds summary sections via shared stage shell helper", () => {
    renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "5s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "failed",
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          outputPath: "review.md",
          duration: "3s",
          status: "failed",
        },
      ],
      suppressHint: true,
      isTty: false,
    });

    expect(buildStageFrameSectionsMock).toHaveBeenCalledTimes(1);
  });

  it("spec adapter renders final stage frame via shared helper", () => {
    renderSpecTranscript(".voratiq/specs/test.md", { suppressHint: true });

    expect(renderStageFinalFrameMock).toHaveBeenCalledTimes(1);
    expect(renderStageFinalFrameMock).toHaveBeenCalledWith({
      metadataLines: ["Spec saved: .voratiq/specs/test.md"],
      hint: undefined,
    });
  });
});
