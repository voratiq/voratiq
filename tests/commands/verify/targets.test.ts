import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveVerifyTarget } from "../../../src/commands/verify/targets.js";
import { appendMessageRecord } from "../../../src/domain/message/persistence/adapter.js";
import { appendReductionRecord } from "../../../src/domain/reduce/persistence/adapter.js";
import { appendRunRecord } from "../../../src/domain/run/persistence/adapter.js";
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
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
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

describe("resolveVerifyTarget (message target)", () => {
  it("resolves succeeded message recipients with canonical response artifacts", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-message-target-"),
    );

    try {
      await createWorkspace(root);

      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: "message-123",
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:05.000Z",
          status: "succeeded",
          prompt: "Review this reply.",
          recipients: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              outputPath:
                ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
              error: null,
            },
            {
              agentId: "agent-b",
              status: "failed",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              error: "failed",
            },
          ],
          error: null,
        },
      });

      const resolved = await resolveVerifyTarget({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        runsFilePath: join(root, ".voratiq", "run", "index.json"),
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: {
          kind: "message",
          sessionId: "message-123",
        },
      });

      expect(resolved.target).toEqual({
        kind: "message",
        sessionId: "message-123",
      });
      expect("messageRecord" in resolved).toBe(true);
      expect(resolved.competitiveCandidates).toEqual([
        {
          canonicalId: "agent-a",
          forbiddenIdentityTokens: ["agent-a"],
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects non-terminal message sessions with a status-specific error", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-message-running-"),
    );

    try {
      await createWorkspace(root);

      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: "message-running",
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          status: "running",
          prompt: "Review this reply.",
          recipients: [
            {
              agentId: "agent-a",
              status: "running",
              startedAt: "2026-04-06T00:00:00.000Z",
              error: null,
            },
          ],
          error: null,
        },
      });

      await expect(
        resolveVerifyTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: {
            kind: "message",
            sessionId: "message-running",
          },
        }),
      ).rejects.toThrow(/message session `message-running` is not complete/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects message sessions without verifiable response artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-message-empty-"));

    try {
      await createWorkspace(root);

      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: "message-empty",
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:05.000Z",
          status: "failed",
          prompt: "Review this reply.",
          recipients: [
            {
              agentId: "agent-a",
              status: "failed",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              error: "failed",
            },
          ],
          error: "failed",
        },
      });

      await expect(
        resolveVerifyTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: {
            kind: "message",
            sessionId: "message-empty",
          },
        }),
      ).rejects.toThrow(/no verifiable message responses/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveVerifyTarget (reduction target)", () => {
  it("resolves baseRevisionSha for reductions targeting message sessions", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-message-reduction-"),
    );

    try {
      await createWorkspace(root);

      const messageId = "message-123";
      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: messageId,
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:05.000Z",
          status: "succeeded",
          baseRevisionSha: "message-base-sha",
          prompt: "Review the change.",
          recipients: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              outputPath:
                ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
              error: null,
            },
          ],
          error: null,
        },
      });

      await appendReductionRecord({
        root,
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        record: {
          sessionId: "reduce-123",
          target: { type: "message", id: messageId },
          createdAt: "2026-04-06T00:10:00.000Z",
          startedAt: "2026-04-06T00:10:00.000Z",
          completedAt: "2026-04-06T00:10:05.000Z",
          status: "succeeded",
          reducers: [
            {
              agentId: "reducer-a",
              status: "succeeded",
              outputPath:
                ".voratiq/reduce/sessions/reduce-123/reducer-a/artifacts/reduction.md",
              dataPath:
                ".voratiq/reduce/sessions/reduce-123/reducer-a/artifacts/reduction.json",
              startedAt: "2026-04-06T00:10:00.000Z",
              completedAt: "2026-04-06T00:10:05.000Z",
              error: null,
            },
          ],
          error: null,
        },
      });

      const resolved = await resolveVerifyTarget({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        runsFilePath: join(root, ".voratiq", "run", "index.json"),
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: {
          kind: "reduce",
          sessionId: "reduce-123",
        },
      });

      expect("baseRevisionSha" in resolved).toBe(true);
      if (!("baseRevisionSha" in resolved)) {
        throw new Error("expected reduce target to retain baseRevisionSha");
      }
      expect(resolved.baseRevisionSha).toBe("message-base-sha");
      expect(resolved.target).toEqual({
        kind: "reduce",
        sessionId: "reduce-123",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to artifact-only reduction verification when message lineage has no base revision", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-message-reduction-no-base-"),
    );

    try {
      await createWorkspace(root);

      const messageId = "message-no-base";
      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: messageId,
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:05.000Z",
          status: "succeeded",
          prompt: "Review the change.",
          recipients: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              outputPath:
                ".voratiq/message/sessions/message-no-base/agent-a/artifacts/response.md",
              error: null,
            },
          ],
          error: null,
        },
      });

      await appendReductionRecord({
        root,
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        record: {
          sessionId: "reduce-no-base",
          target: { type: "message", id: messageId },
          createdAt: "2026-04-06T00:10:00.000Z",
          startedAt: "2026-04-06T00:10:00.000Z",
          completedAt: "2026-04-06T00:10:05.000Z",
          status: "succeeded",
          reducers: [
            {
              agentId: "reducer-a",
              status: "succeeded",
              outputPath:
                ".voratiq/reduce/sessions/reduce-no-base/reducer-a/artifacts/reduction.md",
              dataPath:
                ".voratiq/reduce/sessions/reduce-no-base/reducer-a/artifacts/reduction.json",
              startedAt: "2026-04-06T00:10:00.000Z",
              completedAt: "2026-04-06T00:10:05.000Z",
              error: null,
            },
          ],
          error: null,
        },
      });

      const resolved = await resolveVerifyTarget({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        runsFilePath: join(root, ".voratiq", "run", "index.json"),
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: {
          kind: "reduce",
          sessionId: "reduce-no-base",
        },
      });

      expect("baseRevisionSha" in resolved).toBe(false);
      expect("referenceRepoUnavailable" in resolved).toBe(true);
      if (!("referenceRepoUnavailable" in resolved)) {
        throw new Error(
          "expected reduce target to mark missing reference repo lineage",
        );
      }
      expect(resolved.referenceRepoUnavailable).toEqual({
        reason: "message-lineage",
        messageSessionId: "message-no-base",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
