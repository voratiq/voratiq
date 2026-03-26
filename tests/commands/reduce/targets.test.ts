import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { assertReductionTargetEligible } from "../../../src/commands/reduce/targets.js";
import { appendRunRecord } from "../../../src/domain/run/persistence/adapter.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

describe("assertReductionTargetEligible (run target)", () => {
  it("allows pruned runs when durable artifacts are still present", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-pruned-"));

    try {
      await createWorkspace(root);

      const runId = "run-pruned";
      const agentId = "agent-1";
      const specPath = "specs/reduce-pruned.md";

      await seedRunArtifacts({
        root,
        runId,
        agentId,
        specPath,
        includeDiff: true,
        includeSummary: true,
      });

      const runsFilePath = join(root, ".voratiq", "run", "index.json");
      await appendRunRecord({
        root,
        runsFilePath,
        record: createRunRecord({
          runId,
          spec: { path: specPath },
          status: "pruned",
          deletedAt: new Date().toISOString(),
          agents: [
            createAgentInvocationRecord({
              agentId,
              status: "succeeded",
              artifacts: {
                diffCaptured: true,
                summaryCaptured: true,
                stdoutCaptured: true,
                stderrCaptured: true,
              },
            }),
          ],
        }),
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath,
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "run", id: runId },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails pruned runs with artifact-specific errors when durable artifacts are missing", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-reduce-pruned-missing-"),
    );

    try {
      await createWorkspace(root);

      const runId = "run-pruned-missing";
      const agentId = "agent-1";
      const specPath = "specs/reduce-pruned-missing.md";

      await seedRunArtifacts({
        root,
        runId,
        agentId,
        specPath,
        includeDiff: false,
        includeSummary: true,
      });

      const runsFilePath = join(root, ".voratiq", "run", "index.json");
      await appendRunRecord({
        root,
        runsFilePath,
        record: createRunRecord({
          runId,
          spec: { path: specPath },
          status: "pruned",
          deletedAt: new Date().toISOString(),
          agents: [
            createAgentInvocationRecord({
              agentId,
              status: "succeeded",
              artifacts: {
                diffCaptured: true,
                summaryCaptured: true,
                stdoutCaptured: true,
                stderrCaptured: true,
              },
            }),
          ],
        }),
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath,
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "run", id: runId },
        }),
      ).rejects.toThrow(/missing required artifacts/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function seedRunArtifacts(options: {
  root: string;
  runId: string;
  agentId: string;
  specPath: string;
  includeDiff: boolean;
  includeSummary: boolean;
}): Promise<void> {
  const { root, runId, agentId, specPath, includeDiff, includeSummary } =
    options;

  const specAbsolutePath = join(root, specPath);
  await mkdir(join(specAbsolutePath, ".."), { recursive: true });
  await writeFile(specAbsolutePath, "# reduce\n", "utf8");

  const artifactsDir = join(
    root,
    ".voratiq",
    "run",
    "sessions",
    runId,
    agentId,
    "artifacts",
  );
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "stdout.log"), "stdout\n", "utf8");
  await writeFile(join(artifactsDir, "stderr.log"), "stderr\n", "utf8");
  if (includeDiff) {
    await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");
  }
  if (includeSummary) {
    await writeFile(join(artifactsDir, "summary.txt"), "summary\n", "utf8");
  }
}
