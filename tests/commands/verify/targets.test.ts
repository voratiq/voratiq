import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveVerifyTarget } from "../../../src/commands/verify/targets.js";
import { appendRunRecord } from "../../../src/domains/runs/persistence/adapter.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

describe("resolveVerifyTarget (run target)", () => {
  it("resolves pruned runs instead of rejecting by deletedAt", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-pruned-target-"));

    try {
      await createWorkspace(root);

      const runId = "run-pruned-verify";
      const specPath = "specs/run-pruned-verify.md";
      const specAbsolute = join(root, specPath);
      await mkdir(dirname(specAbsolute), { recursive: true });
      await writeFile(specAbsolute, "# verify\n", "utf8");

      const runsFilePath = join(root, ".voratiq", "runs", "index.json");
      await appendRunRecord({
        root,
        runsFilePath,
        record: createRunRecord({
          runId,
          status: "pruned",
          deletedAt: new Date().toISOString(),
          spec: { path: specPath },
          agents: [
            createAgentInvocationRecord({ agentId: "agent-b" }),
            createAgentInvocationRecord({ agentId: "agent-a" }),
          ],
        }),
      });

      const resolved = await resolveVerifyTarget({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath,
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        verificationsFilePath: join(
          root,
          ".voratiq",
          "verifications",
          "index.json",
        ),
        target: {
          kind: "run",
          sessionId: runId,
        },
      });

      expect(resolved.target).toEqual({
        kind: "run",
        sessionId: runId,
        candidateIds: ["agent-a", "agent-b"],
      });
      expect("runRecord" in resolved).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
