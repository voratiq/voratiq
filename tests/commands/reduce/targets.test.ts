import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { assertReductionTargetEligible } from "../../../src/commands/reduce/targets.js";
import { appendMessageRecord } from "../../../src/domain/message/persistence/adapter.js";
import { appendRunRecord } from "../../../src/domain/run/persistence/adapter.js";
import { appendVerificationRecord } from "../../../src/domain/verify/persistence/adapter.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

describe("assertReductionTargetEligible (run target)", () => {
  it("allows succeeded runs when durable artifacts are still present", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-run-"));

    try {
      await createWorkspace(root);

      const runId = "run-succeeded";
      const agentId = "agent-1";
      const specPath = "specs/reduce-run.md";

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
          status: "succeeded",
          spec: { path: specPath },
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
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "run", id: runId },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails succeeded runs with artifact-specific errors when durable artifacts are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-run-missing-"));

    try {
      await createWorkspace(root);

      const runId = "run-succeeded-missing";
      const agentId = "agent-1";
      const specPath = "specs/reduce-run-missing.md";

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
          status: "succeeded",
          spec: { path: specPath },
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
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "run", id: runId },
        }),
      ).rejects.toThrow(/missing required artifacts/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("assertReductionTargetEligible (message target)", () => {
  it("allows succeeded message sessions with durable outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-message-"));

    try {
      await createWorkspace(root);

      const messageId = "message-succeeded";
      const outputPath = `.voratiq/message/sessions/${messageId}/agent-a/artifacts/response.md`;
      await seedMessageArtifact({ root, outputPath });

      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: messageId,
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:05.000Z",
          status: "succeeded",
          baseRevisionSha: "base-sha",
          prompt: "Review the session.",
          recipients: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              outputPath,
              error: null,
            },
          ],
          error: null,
        },
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "message", id: messageId },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails succeeded message sessions when durable outputs are missing", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-reduce-message-missing-"),
    );

    try {
      await createWorkspace(root);

      const messageId = "message-missing";
      const outputPath = `.voratiq/message/sessions/${messageId}/agent-a/artifacts/response.md`;

      await appendMessageRecord({
        root,
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        record: {
          sessionId: messageId,
          createdAt: "2026-04-06T00:00:00.000Z",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:05.000Z",
          status: "succeeded",
          baseRevisionSha: "base-sha",
          prompt: "Review the session.",
          recipients: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-04-06T00:00:00.000Z",
              completedAt: "2026-04-06T00:00:05.000Z",
              outputPath,
              error: null,
            },
          ],
          error: null,
        },
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "message", id: messageId },
        }),
      ).rejects.toThrow(/missing required artifacts/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("assertReductionTargetEligible (reduction target)", () => {
  it("allows mixed-outcome reduction sessions when succeeded reducers have artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-target-"));

    try {
      await createWorkspace(root);

      const reductionId = "reduce-mixed";
      const succeededOutput = `.voratiq/reduce/sessions/${reductionId}/alpha/artifacts/reduction.md`;
      const succeededData = `.voratiq/reduce/sessions/${reductionId}/alpha/artifacts/reduction.json`;

      await mkdir(
        join(
          root,
          ".voratiq",
          "reduce",
          "sessions",
          reductionId,
          "alpha",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(join(root, succeededOutput), "# Reduction\n", "utf8");
      await writeFile(join(root, succeededData), '{"summary":"ok"}\n', "utf8");

      await writeReductionSession(root, {
        sessionId: reductionId,
        target: { type: "run", id: "run-123" },
        createdAt: "2026-04-12T00:00:00.000Z",
        startedAt: "2026-04-12T00:00:00.000Z",
        completedAt: "2026-04-12T00:00:05.000Z",
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath: succeededOutput,
            dataPath: succeededData,
            startedAt: "2026-04-12T00:00:00.000Z",
            completedAt: "2026-04-12T00:00:02.000Z",
            error: null,
          },
          {
            agentId: "beta",
            status: "failed",
            outputPath: `.voratiq/reduce/sessions/${reductionId}/beta/artifacts/reduction.md`,
            dataPath: `.voratiq/reduce/sessions/${reductionId}/beta/artifacts/reduction.json`,
            startedAt: "2026-04-12T00:00:00.000Z",
            completedAt: "2026-04-12T00:00:03.000Z",
            error: "contract mismatch",
          },
        ],
        error: null,
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "reduce", id: reductionId },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails reduction targets that have no successful reducer artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-target-empty-"));

    try {
      await createWorkspace(root);

      const reductionId = "reduce-none";
      await writeReductionSession(root, {
        sessionId: reductionId,
        target: { type: "run", id: "run-123" },
        createdAt: "2026-04-12T00:00:00.000Z",
        startedAt: "2026-04-12T00:00:00.000Z",
        completedAt: "2026-04-12T00:00:05.000Z",
        status: "succeeded",
        reducers: [
          {
            agentId: "beta",
            status: "failed",
            outputPath: `.voratiq/reduce/sessions/${reductionId}/beta/artifacts/reduction.md`,
            dataPath: `.voratiq/reduce/sessions/${reductionId}/beta/artifacts/reduction.json`,
            startedAt: "2026-04-12T00:00:00.000Z",
            completedAt: "2026-04-12T00:00:03.000Z",
            error: "contract mismatch",
          },
        ],
        error: null,
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "reduce", id: reductionId },
        }),
      ).rejects.toThrow(/has no successful reduction artifacts/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("assertReductionTargetEligible (verification target)", () => {
  it("fails verification targets that have no reduction-ready artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-verify-empty-"));

    try {
      await createWorkspace(root);

      await appendVerificationRecord({
        root,
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        record: {
          sessionId: "verify-empty",
          createdAt: "2026-04-12T00:00:00.000Z",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:05.000Z",
          status: "succeeded",
          target: {
            kind: "run",
            sessionId: "run-123",
            candidateIds: ["alpha"],
          },
          methods: [],
          error: null,
        },
      });

      await expect(
        assertReductionTargetEligible({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          runsFilePath: join(root, ".voratiq", "run", "index.json"),
          reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
          messagesFilePath: join(root, ".voratiq", "message", "index.json"),
          verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
          target: { type: "verify", id: "verify-empty" },
        }),
      ).rejects.toThrow(/no reduction-ready artifacts/iu);
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

async function writeReductionSession(
  root: string,
  record: {
    sessionId: string;
    target: { type: "run"; id: string };
    createdAt: string;
    startedAt: string;
    completedAt: string;
    status: "succeeded";
    reducers: Array<{
      agentId: string;
      status: "succeeded" | "failed";
      outputPath: string;
      dataPath: string;
      startedAt: string;
      completedAt: string;
      error: string | null;
    }>;
    error: string | null;
  },
): Promise<void> {
  const reduceDir = join(root, ".voratiq", "reduce");
  const sessionsDir = join(reduceDir, "sessions", record.sessionId);
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(reduceDir, "index.json"),
    JSON.stringify({
      version: 1,
      sessions: [
        {
          sessionId: record.sessionId,
          createdAt: record.createdAt,
          status: record.status,
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(sessionsDir, "record.json"),
    JSON.stringify(record),
    "utf8",
  );
}

async function seedMessageArtifact(options: {
  root: string;
  outputPath: string;
}): Promise<void> {
  const absolutePath = join(options.root, options.outputPath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, "# response\n", "utf8");
}
