import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { collectAgentArtifacts } from "../../../../src/domains/runs/competition/agents/artifacts.js";
import { runPostProcessingAndCollectArtifacts } from "../../../../src/domains/runs/competition/agents/post-processing.js";
import { buildRunAgentWorkspacePaths } from "../../../../src/domains/runs/competition/agents/workspace.js";
import { buildAgentWorkspacePaths } from "../../../../src/workspace/layout.js";

jest.mock(
  "../../../../src/domains/runs/competition/agents/artifacts.js",
  () => ({
    collectAgentArtifacts: jest.fn(),
  }),
);

const collectAgentArtifactsMock = jest.mocked(collectAgentArtifacts);

const tempRoots: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  collectAgentArtifactsMock.mockResolvedValue({
    summaryCaptured: false,
    diffAttempted: false,
    diffCaptured: false,
  });
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runPostProcessingAndCollectArtifacts integration", () => {
  it("returns artifacts without eval wrappers", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-post-process-int-"));
    tempRoots.push(root);

    const corePaths = buildAgentWorkspacePaths({
      root,
      runId: "run-1",
      agentId: "agent-1",
    });
    const workspacePaths = buildRunAgentWorkspacePaths({
      root,
      runId: "run-1",
      agentId: "agent-1",
      corePaths,
    });

    await mkdir(workspacePaths.workspacePath, { recursive: true });

    const result = await runPostProcessingAndCollectArtifacts({
      workspacePaths,
      baseRevisionSha: "abc123",
      root,
      environment: {
        python: { path: ".venv" },
      },
      persona: {
        authorName: "Sandbox",
        authorEmail: "sandbox@example.com",
      },
    });

    expect(result.diffCaptured).toBe(false);
  });
});
