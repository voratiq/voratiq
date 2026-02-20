import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveEligibleReviewCandidateAgents } from "../../../src/commands/review/eligibility.js";
import { buildRunRecordEnhanced } from "../../../src/runs/records/enhanced.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

describe("review candidate eligibility", () => {
  it("includes only succeeded agents with non-empty captured diffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-review-eligibility-"));
    try {
      const runId = "run-eligibility-mixed";

      const eligibleAgentId = "agent-ok";
      const eligibleDiffRel = join(
        ".voratiq",
        "runs",
        "sessions",
        runId,
        eligibleAgentId,
        "artifacts",
        "diff.patch",
      );
      await mkdir(dirname(join(root, eligibleDiffRel)), { recursive: true });
      await writeFile(
        join(root, eligibleDiffRel),
        "diff --git a/src/index.ts b/src/index.ts\n+ok\n",
        "utf8",
      );

      const record = createRunRecord({
        runId,
        agents: [
          createAgentInvocationRecord({
            agentId: eligibleAgentId,
            status: "succeeded",
            artifacts: {
              diffCaptured: true,
              diffAttempted: true,
              stdoutCaptured: false,
              stderrCaptured: false,
              summaryCaptured: false,
            },
          }),
          createAgentInvocationRecord({
            agentId: "agent-failed",
            status: "failed",
            error: "ENOENT: /tmp/agent-failed/.summary.txt",
            artifacts: {
              diffCaptured: true,
              diffAttempted: true,
              stdoutCaptured: false,
              stderrCaptured: false,
              summaryCaptured: false,
            },
          }),
          createAgentInvocationRecord({
            agentId: "agent-nodiff",
            status: "succeeded",
            artifacts: {
              diffCaptured: false,
              diffAttempted: true,
              stdoutCaptured: false,
              stderrCaptured: false,
              summaryCaptured: false,
            },
          }),
        ],
      });

      const run = buildRunRecordEnhanced(record);
      const eligible = await resolveEligibleReviewCandidateAgents({
        root,
        run,
      });

      expect(eligible).toHaveLength(1);
      expect(eligible[0]?.agent.agentId).toBe(eligibleAgentId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes captured diffs that are empty files", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-review-eligibility-"));
    try {
      const runId = "run-eligibility-empty-diff";
      const agentId = "agent-empty";

      const diffRel = join(
        ".voratiq",
        "runs",
        "sessions",
        runId,
        agentId,
        "artifacts",
        "diff.patch",
      );
      await mkdir(dirname(join(root, diffRel)), { recursive: true });
      await writeFile(join(root, diffRel), "", "utf8");

      const record = createRunRecord({
        runId,
        agents: [
          createAgentInvocationRecord({
            agentId,
            status: "succeeded",
            artifacts: {
              diffCaptured: true,
              diffAttempted: true,
              stdoutCaptured: false,
              stderrCaptured: false,
              summaryCaptured: false,
            },
          }),
        ],
      });

      const run = buildRunRecordEnhanced(record);
      const eligible = await resolveEligibleReviewCandidateAgents({
        root,
        run,
      });

      expect(eligible).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
