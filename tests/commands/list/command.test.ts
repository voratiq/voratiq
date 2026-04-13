import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeListCommand } from "../../../src/commands/list/command.js";
import {
  formatTargetTablePreview,
  TARGET_TABLE_PREVIEW_LENGTH,
} from "../../../src/commands/list/normalization.js";
import type { InteractiveSessionRecord } from "../../../src/domain/interactive/model/types.js";
import { appendInteractiveSessionRecord } from "../../../src/domain/interactive/persistence/adapter.js";
import type { MessageRecord } from "../../../src/domain/message/model/types.js";
import { appendMessageRecord } from "../../../src/domain/message/persistence/adapter.js";
import type { ReductionRecord } from "../../../src/domain/reduce/model/types.js";
import { appendReductionRecord } from "../../../src/domain/reduce/persistence/adapter.js";
import type { RunRecord } from "../../../src/domain/run/model/types.js";
import { appendRunRecord } from "../../../src/domain/run/persistence/adapter.js";
import type { SpecRecord } from "../../../src/domain/spec/model/types.js";
import { appendSpecRecord } from "../../../src/domain/spec/persistence/adapter.js";
import type { VerificationRecord } from "../../../src/domain/verify/model/types.js";
import { appendVerificationRecord } from "../../../src/domain/verify/persistence/adapter.js";
import { formatRunTimestamp } from "../../../src/render/utils/records.js";
import { createRunRecord } from "../../support/factories/run-records.js";

describe("executeListCommand", () => {
  let testDir: string;
  let specsFilePath: string;
  let runsFilePath: string;
  let messagesFilePath: string;
  let reductionsFilePath: string;
  let verificationsFilePath: string;
  let interactiveFilePath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "voratiq-list-test-"));
    specsFilePath = join(testDir, ".voratiq", "spec", "index.json");
    runsFilePath = join(testDir, ".voratiq", "run", "index.json");
    messagesFilePath = join(testDir, ".voratiq", "message", "index.json");
    reductionsFilePath = join(testDir, ".voratiq", "reduce", "index.json");
    verificationsFilePath = join(testDir, ".voratiq", "verify", "index.json");
    interactiveFilePath = join(
      testDir,
      ".voratiq",
      "interactive",
      "index.json",
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("renders run table view with default hidden statuses", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-visible",
        status: "succeeded",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-pruned",
        status: "pruned",
        createdAt: "2026-03-01T00:01:00.000Z",
        deletedAt: "2026-03-02T00:00:00.000Z",
      }),
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-aborted",
        status: "aborted",
        createdAt: "2026-03-01T00:02:00.000Z",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
      }),
    );

    expect(result.mode).toBe("table");
    expect(result.output).toContain("RUN");
    expect(result.output).toContain("TARGET");
    expect(result.output).toContain("STATUS");
    expect(result.output).toContain("CREATED");
    expect(result.output).toContain("run-visible");
    expect(result.output).toContain("file:specs/task.md");
    expect(result.output).not.toContain("run-pruned");
    expect(result.output).not.toContain("run-aborted");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "list",
      sessions: [
        {
          sessionId: "run-visible",
          target: {
            kind: "file",
            path: "specs/task.md",
          },
        },
      ],
    });
  });

  it("includes run aborted and pruned statuses with --verbose", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-visible",
        status: "succeeded",
      }),
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-pruned",
        status: "pruned",
        deletedAt: "2026-03-02T00:00:00.000Z",
      }),
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-aborted",
        status: "aborted",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        verbose: true,
      }),
    );

    expect(result.output).toContain("run-visible");
    expect(result.output).toContain("run-pruned");
    expect(result.output).toContain("run-aborted");
    expect(result.output).toContain("PRUNED");
    expect(result.output).toContain("ABORTED");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "list",
      sessions: [
        { sessionId: "run-aborted" },
        { sessionId: "run-pruned" },
        { sessionId: "run-visible" },
      ],
    });
  });

  it("applies --limit after default filtering in table mode", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-oldest",
        createdAt: "2026-03-01T00:00:00.000Z",
        status: "succeeded",
      }),
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-visible-newest",
        createdAt: "2026-03-01T00:01:00.000Z",
        status: "succeeded",
      }),
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-hidden-aborted",
        createdAt: "2026-03-01T00:02:00.000Z",
        status: "aborted",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        limit: 1,
      }),
    );

    expect(result.output).toContain("run-visible-newest");
    expect(result.output).not.toContain("run-oldest");
    expect(result.output).not.toContain("run-hidden-aborted");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "list",
      sessions: [{ sessionId: "run-visible-newest" }],
    });
  });

  it("renders run detail view for a pruned run", async () => {
    const record = buildRunRecord({
      runId: "run-pruned",
      status: "pruned",
      deletedAt: "2026-03-02T00:00:00.000Z",
    });
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record,
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        sessionId: "run-pruned",
      }),
    );

    expect(result.mode).toBe("detail");
    expect(result.output).toContain("run-pruned");
    expect(result.output).toContain("PRUNED");
    expect(result.output).toContain("Workspace");
    expect(result.output).toContain("Target");
    expect(result.output).toContain("file:specs/task.md");
    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/run/sessions/run-pruned/agent-a/artifacts/diff.patch",
    );
    expect(result.output).not.toContain("Base Revision");
    expect(result.output).not.toContain("\nSpec");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "detail",
      session: {
        sessionId: "run-pruned",
        target: {
          kind: "file",
          path: "specs/task.md",
        },
        agents: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "succeeded",
            artifacts: [
              expect.objectContaining({
                kind: "diff",
                role: "output",
                path: ".voratiq/run/sessions/run-pruned/agent-a/artifacts/diff.patch",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("normalizes run spec-session lineage to a session target", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: {
        ...buildRunRecord({
          runId: "run-from-spec-session",
          status: "succeeded",
        }),
        spec: {
          path: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
          target: {
            kind: "spec",
            sessionId: "spec-123",
          },
        },
      },
    });

    const tableResult = await executeListCommand(
      buildInput({
        operator: "run",
      }),
    );

    expect(tableResult.output).toContain("spec:spec-123");
    expect(tableResult.json).toMatchObject({
      operator: "run",
      mode: "list",
      sessions: [
        expect.objectContaining({
          sessionId: "run-from-spec-session",
          target: {
            kind: "spec",
            sessionId: "spec-123",
          },
        }),
      ],
    });

    const detailResult = await executeListCommand(
      buildInput({
        operator: "run",
        sessionId: "run-from-spec-session",
      }),
    );

    expect(detailResult.output).toContain("Target");
    expect(detailResult.output).toContain("spec:spec-123");
    expect(detailResult.output).toContain(
      "Output: .voratiq/run/sessions/run-from-spec-session/agent-a/artifacts/diff.patch",
    );
    expect(detailResult.json).toMatchObject({
      operator: "run",
      mode: "detail",
      session: {
        sessionId: "run-from-spec-session",
        target: {
          kind: "spec",
          sessionId: "spec-123",
        },
        agents: [
          expect.objectContaining({
            agentId: "agent-a",
            artifacts: [
              expect.objectContaining({
                kind: "diff",
                role: "output",
                path: ".voratiq/run/sessions/run-from-spec-session/agent-a/artifacts/diff.patch",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("renders missing run diff artifacts as '-' and null in detail output", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: {
        ...buildRunRecord({
          runId: "run-without-diff-artifact",
          status: "succeeded",
        }),
        agents: [
          {
            agentId: "agent-a",
            model: "model",
            status: "succeeded",
            startedAt: "2026-03-01T00:00:00.000Z",
            completedAt: "2026-03-01T00:05:00.000Z",
            artifacts: {
              diffAttempted: true,
              diffCaptured: false,
            },
          },
        ],
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        sessionId: "run-without-diff-artifact",
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain("Output: —");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "detail",
      session: {
        sessionId: "run-without-diff-artifact",
        agents: [
          expect.objectContaining({
            agentId: "agent-a",
            artifacts: [],
          }),
        ],
      },
    });
  });

  it("keeps run file lineage as a file target", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: {
        ...buildRunRecord({
          runId: "run-from-file-target",
          status: "succeeded",
        }),
        spec: {
          path: "specs/manual-review.md",
          target: {
            kind: "file",
          },
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
      }),
    );

    expect(result.output).toContain("file:specs/manual-review.md");
    expect(result.output).not.toContain("spec:run-from-file-target");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "list",
      sessions: [
        expect.objectContaining({
          sessionId: "run-from-file-target",
          target: {
            kind: "file",
            path: "specs/manual-review.md",
          },
        }),
      ],
    });
  });

  it("middle-elides long run TARGET values to a 32-character preview", async () => {
    const longSpecPath =
      ".voratiq/spec/sessions/20260327-043019-uatir/gpt-5-4-high/artifacts/clean-up-stale-review-terminology-in-auto-verify-test-surface.md";
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: {
        ...buildRunRecord({
          runId: "run-long-target",
          status: "succeeded",
        }),
        spec: {
          path: longSpecPath,
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
      }),
    );

    const expectedPreview = formatTargetTablePreview({
      kind: "file",
      path: longSpecPath,
    });
    const lines = result.output?.split("\n") ?? [];

    expect(lines).toHaveLength(2);
    expect(expectedPreview.length).toBe(TARGET_TABLE_PREVIEW_LENGTH);
    expect(expectedPreview.startsWith("file:")).toBe(true);
    expect(expectedPreview.includes("...")).toBe(true);
    expect(expectedPreview.endsWith("surface.md")).toBe(true);
    expect(lines[1]).toContain(expectedPreview);
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "list",
      sessions: [
        expect.objectContaining({
          sessionId: "run-long-target",
          target: {
            kind: "file",
            path: longSpecPath,
          },
        }),
      ],
    });
  });

  it("renders spec table with default aborted filtering and verbose override", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-visible",
        status: "succeeded",
      }),
    });
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-aborted",
        status: "aborted",
      }),
    });

    const defaultResult = await executeListCommand(
      buildInput({
        operator: "spec",
      }),
    );
    expect(defaultResult.output).toContain("SPEC");
    expect(defaultResult.output).toContain("DESCRIPTION");
    expect(defaultResult.output).toContain("spec-visible");
    expect(defaultResult.output).toContain("Generate task spec");
    expect(defaultResult.output).not.toContain("spec-aborted");

    const verboseResult = await executeListCommand(
      buildInput({
        operator: "spec",
        verbose: true,
      }),
    );
    expect(verboseResult.output).toContain("spec-visible");
    expect(verboseResult.output).toContain("spec-aborted");
    expect(verboseResult.output).toContain("ABORTED");
    expect(verboseResult.json).toMatchObject({
      operator: "spec",
      mode: "list",
    });
    expect(verboseResult.json.mode).toBe("list");
    if (verboseResult.json.mode !== "list") {
      throw new Error("Expected list-mode JSON output");
    }
    expect(verboseResult.json.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "spec-visible",
          description: "Generate task spec",
        }),
        expect.objectContaining({
          sessionId: "spec-aborted",
          description: "Generate task spec",
        }),
      ]),
    );
  });

  it("renders a missing spec description as an em dash", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: {
        ...buildSpecRecord({
          sessionId: "spec-running",
          status: "running",
          agents: [
            {
              agentId: "agent-a",
              status: "running",
              startedAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        }),
        description: "",
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
      }),
    );

    expect(result.output).toContain("spec-running");
    expect(result.output).toContain("—");
    expect(result.json).toMatchObject({
      operator: "spec",
      mode: "list",
    });
    if (result.json.mode !== "list") {
      throw new Error("Expected list-mode JSON output");
    }
    expect(result.json.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "spec-running",
          description: null,
        }),
      ]),
    );
  });

  it("renders spec detail for an aborted session", async () => {
    const spec = buildSpecRecord({
      sessionId: "spec-aborted",
      status: "aborted",
      agents: [
        {
          agentId: "agent-a",
          status: "failed",
          startedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-03-01T00:05:00.000Z",
          error: "failed",
        },
      ],
    });
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: spec,
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-aborted",
      }),
    );

    expect(result.output).toContain("spec-aborted");
    expect(result.output).toContain("ABORTED");
    expect(result.output).toContain("AGENT");
    expect(result.output).not.toContain("Description");
    expect(result.json).toMatchObject({
      operator: "spec",
      mode: "detail",
      session: {
        sessionId: "spec-aborted",
        agents: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "failed",
            artifacts: [],
          }),
        ],
      },
    });
    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail-mode spec json output");
    }
    expect(result.json.session).not.toHaveProperty("target");
  });

  it("renders spec detail running rows with suppressed duration", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-running",
        status: "running",
        agents: [
          {
            agentId: "agent-a",
            status: "running",
            startedAt: "2026-03-01T00:00:00.000Z",
          },
        ],
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-running",
      }),
    );

    const row = findDetailTableRow(result.output, "agent-a", "RUNNING");
    expect(result.output).toContain("Elapsed");
    expect(row).toContain("RUNNING");
    expect(row).toContain("—");
  });

  it("renders spec detail terminal rows with completed duration", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-detail",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-detail",
      }),
    );

    const row = findDetailTableRow(result.output, "agent-a", "SUCCEEDED");
    expect(row).toContain("SUCCEEDED");
    expect(row).toContain("5m");
  });

  it("normalizes spec description text in table json", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: {
        ...buildSpecRecord({
          sessionId: "spec-messy",
          status: "succeeded",
        }),
        description: "Generalize \nNo runs recorded. ",
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
      }),
    );

    expect(result.json).toMatchObject({
      operator: "spec",
      mode: "list",
    });
    if (result.json.mode !== "list") {
      throw new Error("Expected list-mode JSON output");
    }
    expect(result.json.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "spec-messy",
          description: "Generalize No runs recorded.",
        }),
      ]),
    );
  });

  it("returns curated spec detail json instead of the raw record", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-detail-json",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-detail-json",
      }),
    );

    expect(result.json).toMatchObject({
      operator: "spec",
      mode: "detail",
      session: {
        sessionId: "spec-detail-json",
        agents: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "succeeded",
            artifacts: [
              expect.objectContaining({
                kind: "spec",
                role: "output",
                path: ".voratiq/spec/sessions/spec-detail-json/agent-a/artifacts/spec.md",
              }),
              expect.objectContaining({
                kind: "spec",
                role: "data",
                path: ".voratiq/spec/sessions/spec-detail-json/agent-a/artifacts/spec.json",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("renders a missing spec artifact as '-' in spec detail", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-running",
        status: "running",
        agents: [
          {
            agentId: "agent-a",
            status: "running",
            startedAt: "2026-03-01T00:00:00.000Z",
          },
        ],
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-running",
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain("Output: —");
  });

  it("renders reduce table with TARGET column and aborted filtering", async () => {
    await appendReductionRecord({
      root: testDir,
      reductionsFilePath,
      record: buildReductionRecord({
        sessionId: "reduce-visible",
        status: "succeeded",
        target: { type: "run", id: "run-123" },
      }),
    });
    await appendReductionRecord({
      root: testDir,
      reductionsFilePath,
      record: buildReductionRecord({
        sessionId: "reduce-aborted",
        status: "aborted",
        target: { type: "spec", id: "spec-123" },
      }),
    });

    const defaultResult = await executeListCommand(
      buildInput({
        operator: "reduce",
      }),
    );
    expect(defaultResult.output).toContain("REDUCE");
    expect(defaultResult.output).toContain("TARGET");
    expect(defaultResult.output).toContain("reduce-visible");
    expect(defaultResult.output).not.toContain("reduce-aborted");

    const verboseResult = await executeListCommand(
      buildInput({
        operator: "reduce",
        verbose: true,
      }),
    );
    expect(verboseResult.output).toContain("reduce-aborted");
  });

  it("renders reduce detail with reducer status table", async () => {
    const reduction = buildReductionRecord({
      sessionId: "reduce-detail",
      status: "succeeded",
      target: { type: "run", id: "run-123" },
    });
    await appendReductionRecord({
      root: testDir,
      reductionsFilePath,
      record: reduction,
    });

    const result = await executeListCommand(
      buildInput({
        operator: "reduce",
        sessionId: "reduce-detail",
      }),
    );

    expect(result.output).toContain("reduce-detail");
    expect(result.output).toContain("AGENT");
    expect(result.output).toMatch(/Target\s+run:run-123/u);
    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain("Output:");
    expect(result.output).not.toContain("\nRun");
    expect(findDetailTableRow(result.output, "agent-a", "SUCCEEDED")).toContain(
      "5m",
    );
    expect(result.json).toMatchObject({
      operator: "reduce",
      mode: "detail",
      session: {
        sessionId: "reduce-detail",
        target: {
          kind: "run",
          sessionId: "run-123",
        },
        agents: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "succeeded",
            artifacts: [
              expect.objectContaining({
                kind: "reduction",
                role: "output",
                path: ".voratiq/reduce/sessions/reduce-detail/agent-a/reduction.md",
              }),
              expect.objectContaining({
                kind: "reduction",
                role: "data",
                path: ".voratiq/reduce/sessions/reduce-detail/agent-a/reduction.json",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("renders reduce detail running rows with suppressed duration", async () => {
    const reduction = buildReductionRecord({
      sessionId: "reduce-running",
      status: "running",
      target: { type: "run", id: "run-123" },
    });
    reduction.reducers = [
      {
        ...reduction.reducers[0],
        status: "running",
        completedAt: undefined,
      },
    ];
    await appendReductionRecord({
      root: testDir,
      reductionsFilePath,
      record: reduction,
    });

    const result = await executeListCommand(
      buildInput({
        operator: "reduce",
        sessionId: "reduce-running",
      }),
    );

    const row = findDetailTableRow(result.output, "agent-a", "RUNNING");
    expect(result.output).toContain("Elapsed");
    expect(row).toContain("—");
  });

  it("renders message table with TARGET values and without a recipients column", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-visible",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
        },
      }),
    });
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-no-target",
        status: "succeeded",
      }),
    });
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-aborted",
        status: "aborted",
      }),
    });

    const defaultResult = await executeListCommand(
      buildInput({
        operator: "message",
      }),
    );
    const defaultLines = defaultResult.output?.split("\n") ?? [];
    const noTargetLine = defaultLines.find((line) =>
      line.includes("message-no-target"),
    );

    expect(defaultResult.output).toContain("MESSAGE");
    expect(defaultResult.output).toContain("TARGET");
    expect(defaultResult.output).toContain("STATUS");
    expect(defaultResult.output).toContain("CREATED");
    expect(defaultResult.output).not.toContain("RECIPIENTS");
    expect(defaultResult.output).toContain("message-visible");
    expect(defaultResult.output).toContain("run:run-123");
    expect(noTargetLine).toBeDefined();
    expect(noTargetLine).toContain("—");
    expect(defaultResult.output).not.toContain("message-aborted");
    expect(defaultResult.output).not.toContain("PROMPT");
    expect(defaultResult.json).toMatchObject({
      operator: "message",
      mode: "list",
    });
    if (defaultResult.json.mode !== "list") {
      throw new Error("Expected list-mode message json output");
    }
    const targetedRecord = defaultResult.json.sessions.find(
      (entry) => entry.sessionId === "message-visible",
    );
    const noTargetRecord = defaultResult.json.sessions.find(
      (entry) => entry.sessionId === "message-no-target",
    );
    expect(targetedRecord).toBeDefined();
    expect(targetedRecord).toMatchObject({
      sessionId: "message-visible",
      target: {
        kind: "run",
        sessionId: "run-123",
      },
    });
    expect(noTargetRecord).toBeDefined();
    expect(noTargetRecord).toMatchObject({
      sessionId: "message-no-target",
    });
    expect(noTargetRecord).not.toHaveProperty("target");

    const verboseResult = await executeListCommand(
      buildInput({
        operator: "message",
        verbose: true,
      }),
    );
    expect(verboseResult.output).toContain("message-aborted");
  });

  it("middle-elides long message TARGET values to a 32-character preview", async () => {
    const longTargetSessionId =
      "20260327-043019-uatir-very-long-message-target-session-id";
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-long-target",
        status: "succeeded",
        target: {
          kind: "interactive",
          sessionId: longTargetSessionId,
        },
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "message",
      }),
    );

    const expectedPreview = formatTargetTablePreview({
      kind: "interactive",
      sessionId: longTargetSessionId,
    });
    const lines = result.output?.split("\n") ?? [];

    expect(lines).toHaveLength(2);
    expect(expectedPreview.length).toBe(TARGET_TABLE_PREVIEW_LENGTH);
    expect(expectedPreview.startsWith("interactive:")).toBe(true);
    expect(expectedPreview.includes("...")).toBe(true);
    expect(expectedPreview.endsWith("target-session-id")).toBe(true);
    expect(lines[1]).toContain(expectedPreview);
    expect(result.json).toMatchObject({
      operator: "message",
      mode: "list",
      sessions: [
        expect.objectContaining({
          sessionId: "message-long-target",
          target: {
            kind: "interactive",
            sessionId: longTargetSessionId,
          },
        }),
      ],
    });
  });

  it("renders message detail like other operator detail views", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-detail",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "message",
        sessionId: "message-detail",
      }),
    );

    expect(result.output).toContain("message-detail");
    expect(result.output).toContain("AGENT");
    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain("Output:");
    expect(result.output).not.toContain("Request:");
    expect(result.output).not.toContain("Response:");
    expect(result.output).not.toContain("Response data:");
    expect(result.output).not.toContain("\nStatus: ");
    expect(result.output).not.toContain("\nDuration: ");
    expect(result.output).not.toContain("Target:");
    expect(result.output).toContain("\n---\n");
    expect(result.output?.trimEnd().endsWith("---")).toBe(false);
    expect(findDetailTableRow(result.output, "agent-a", "SUCCEEDED")).toContain(
      "5m",
    );
  });

  it("renders message detail running rows with suppressed duration", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-running",
        status: "running",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "message",
        sessionId: "message-running",
      }),
    );

    const row = findDetailTableRow(result.output, "agent-a", "RUNNING");
    expect(result.output).toContain("Elapsed");
    expect(row).toContain("—");
  });

  it("renders persisted message targets in detail transcript and json", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-target-detail",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
        },
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "message",
        sessionId: "message-target-detail",
      }),
    );

    expect(result.output).toMatch(/Target\s+run:run-123/u);
    expect(result.json).toMatchObject({
      operator: "message",
      mode: "detail",
      session: {
        sessionId: "message-target-detail",
        target: {
          kind: "run",
          sessionId: "run-123",
        },
      },
    });
  });

  it("renders persisted message lane targets in table and detail json", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-lane-target",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          agentId: "gpt-5-4-high",
        },
      }),
    });

    const tableResult = await executeListCommand(
      buildInput({
        operator: "message",
      }),
    );
    const detailResult = await executeListCommand(
      buildInput({
        operator: "message",
        sessionId: "message-lane-target",
      }),
    );

    expect(tableResult.output).toContain("run:run-123:gpt-5-4-high");
    expect(tableResult.json).toMatchObject({
      operator: "message",
      mode: "list",
      sessions: [
        expect.objectContaining({
          sessionId: "message-lane-target",
          target: {
            kind: "run",
            sessionId: "run-123",
            agentId: "gpt-5-4-high",
          },
        }),
      ],
    });
    expect(detailResult.output).toMatch(/Target\s+run:run-123:gpt-5-4-high/u);
    expect(detailResult.json).toMatchObject({
      operator: "message",
      mode: "detail",
      session: {
        sessionId: "message-lane-target",
        target: {
          kind: "run",
          sessionId: "run-123",
          agentId: "gpt-5-4-high",
        },
      },
    });
  });

  it("keeps message detail rows summary-only and includes only generated artifacts", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-detail-json",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "message",
        sessionId: "message-detail-json",
      }),
    );

    expect(result.json).toMatchObject({
      operator: "message",
      mode: "detail",
    });
    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail-mode message json output");
    }
    expect(result.json.session).not.toHaveProperty("target");
    expect(result.json.session.sessionId).toBe("message-detail-json");
    expect(result.json.session.agents).toHaveLength(1);
    const [firstAgent] = result.json.session.agents;
    expect(firstAgent).toBeDefined();
    expect(firstAgent).toMatchObject({
      agentId: "agent-a",
      status: "succeeded",
      artifacts: [
        {
          kind: "response",
          role: "output",
          path: ".voratiq/message/sessions/message-detail-json/agent-a/artifacts/response.md",
        },
      ],
    });
  });

  it("renders verify table with TARGET column and aborted filtering", async () => {
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-visible",
        status: "succeeded",
      }),
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-aborted",
        status: "aborted",
      }),
    });

    const defaultResult = await executeListCommand(
      buildInput({
        operator: "verify",
      }),
    );
    expect(defaultResult.output).toContain("VERIFY");
    expect(defaultResult.output).toContain("TARGET");
    expect(defaultResult.output).toContain("verify-visible");
    expect(defaultResult.output).not.toContain("verify-aborted");

    const verboseResult = await executeListCommand(
      buildInput({
        operator: "verify",
        verbose: true,
      }),
    );
    expect(verboseResult.output).toContain("verify-aborted");
  });

  it("renders verify detail with method status table", async () => {
    const verification = buildVerificationRecord({
      sessionId: "verify-detail",
      status: "succeeded",
      methods: [
        {
          method: "programmatic",
          slug: "programmatic",
          scope: { kind: "run" },
          status: "succeeded",
          startedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-03-01T00:01:00.000Z",
          artifactPath:
            ".voratiq/verify/sessions/verify-detail/programmatic/artifacts/result.json",
        },
      ],
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: verification,
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-detail",
      }),
    );

    expect(result.output).toContain("verify-detail");
    expect(result.output).toContain("VERIFIER");
    expect(result.output).toContain("programmatic");
    expect(result.output).toContain("Agent: —");
    expect(result.output).toMatch(/Target\s+run:run-123/u);
    expect(result.output).toContain("Output:");
    expect(result.output).not.toContain("\nRun");
    expect(
      findDetailTableRow(result.output, "programmatic", "SUCCEEDED"),
    ).toContain("1m");
    expect(result.json).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        sessionId: "verify-detail",
        target: {
          kind: "run",
          sessionId: "run-123",
        },
        agents: [
          expect.objectContaining({
            agentId: null,
            verifier: "programmatic",
            status: "succeeded",
            artifacts: [
              expect.objectContaining({
                kind: "verification-result",
                role: "output",
                path: ".voratiq/verify/sessions/verify-detail/programmatic/artifacts/result.json",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("renders verify detail running rows with suppressed duration", async () => {
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-running",
        status: "running",
        methods: [
          {
            method: "programmatic",
            slug: "programmatic",
            scope: { kind: "run" },
            status: "running",
            startedAt: "2026-03-01T00:00:00.000Z",
          },
        ],
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-running",
      }),
    );

    const row = findDetailTableRow(result.output, "programmatic", "RUNNING");
    expect(result.output).toContain("Elapsed");
    expect(row).toContain("—");
  });

  it("renders message-target verify detail without mislabeling it as a reduction", async () => {
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: {
        ...buildVerificationRecord({
          sessionId: "verify-message-detail",
          status: "succeeded",
        }),
        target: {
          kind: "message",
          sessionId: "message-123",
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-message-detail",
      }),
    );

    expect(result.output).toMatch(/Target\s+message:message-123/u);
    expect(result.output).not.toMatch(/Target\s+reduce:message-123/u);
    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail-mode verify json output");
    }
    expect(result.json.session.target).toEqual({
      kind: "message",
      sessionId: "message-123",
    });
  });

  it("returns a not-found detail payload when session is missing", async () => {
    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-missing",
      }),
    );

    expect(result.output).toBe("spec session `spec-missing` not found.");
    expect(result.json).toMatchObject({
      operator: "spec",
      mode: "detail",
      session: null,
    });
  });

  it("renders interactive table output through the shared list pipeline", async () => {
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-visible",
        status: "succeeded",
        createdAt: "2026-03-01T00:01:00.000Z",
      }),
    });
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-running",
        status: "running",
        createdAt: "2026-03-01T00:02:00.000Z",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "interactive",
      }),
    );

    expect(result.output).toContain("INTERACTIVE");
    expect(result.output).toContain("STATUS");
    expect(result.output).toContain("CREATED");
    expect(result.output).not.toContain("TARGET");
    expect(result.output).toContain("interactive-running");
    expect(result.output).toContain("interactive-visible");
    expect(result.json).toEqual({
      operator: "interactive",
      mode: "list",
      sessions: [
        {
          operator: "interactive",
          sessionId: "interactive-running",
          status: "running",
          createdAt: "2026-03-01T00:02:00.000Z",
        },
        {
          operator: "interactive",
          sessionId: "interactive-visible",
          status: "succeeded",
          createdAt: "2026-03-01T00:01:00.000Z",
        },
      ],
      warnings: [],
    });
  });

  it("applies interactive default filtering, verbose, and limit in table mode", async () => {
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-oldest",
        status: "succeeded",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-failed",
        status: "failed",
        createdAt: "2026-03-01T00:01:00.000Z",
      }),
    });
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-newest",
        status: "running",
        createdAt: "2026-03-01T00:02:00.000Z",
      }),
    });

    const defaultResult = await executeListCommand(
      buildInput({
        operator: "interactive",
        limit: 2,
      }),
    );

    expect(defaultResult.json).toMatchObject({
      operator: "interactive",
      mode: "list",
      sessions: [
        { sessionId: "interactive-newest" },
        { sessionId: "interactive-failed" },
      ],
    });

    const verboseResult = await executeListCommand(
      buildInput({
        operator: "interactive",
        verbose: true,
      }),
    );

    expect(verboseResult.output).toContain("interactive-oldest");
    expect(verboseResult.output).toContain("interactive-failed");
    expect(verboseResult.output).toContain("interactive-newest");
  });

  it("renders interactive detail output and json without target metadata", async () => {
    const createdAt = "2026-03-01T00:00:00.000Z";
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-detail",
        status: "succeeded",
        createdAt,
        chat: {
          captured: true,
          format: "jsonl",
          artifactPath:
            ".voratiq/interactive/sessions/interactive-detail/artifacts/chat.jsonl",
        },
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "interactive",
        sessionId: "interactive-detail",
      }),
    );

    expect(result.output).toContain("interactive-detail");
    expect(result.output).toContain("SUCCEEDED");
    expect(result.output).toMatch(/Elapsed\s+—/u);
    expect(result.output).toContain(
      `Created    ${formatRunTimestamp(createdAt)}`,
    );
    expect(result.output).toMatch(
      /Workspace\s+\.voratiq\/interactive\/sessions\/interactive-detail/u,
    );
    expect(result.output).not.toContain("Target");
    expect(result.output).toContain("AGENT");
    expect(result.output).toContain("agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/interactive/sessions/interactive-detail/artifacts/chat.jsonl",
    );
    expect(result.json).toEqual({
      operator: "interactive",
      mode: "detail",
      session: {
        operator: "interactive",
        sessionId: "interactive-detail",
        status: "succeeded",
        createdAt: "2026-03-01T00:00:00.000Z",
        workspacePath: ".voratiq/interactive/sessions/interactive-detail",
        agents: [
          {
            agentId: "agent-a",
            status: "succeeded",
            artifacts: [
              {
                kind: "chat",
                role: "output",
                path: ".voratiq/interactive/sessions/interactive-detail/artifacts/chat.jsonl",
              },
            ],
          },
        ],
      },
      warnings: [],
    });
    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail-mode interactive json output");
    }
    expect(result.json.session).not.toHaveProperty("target");
    expect(result.json.session).not.toHaveProperty("elapsed");
  });

  it("renders interactive detail without a captured chat artifact as dash and null", async () => {
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-no-chat",
        status: "failed",
        chat: {
          captured: false,
          errorMessage: "capture unavailable",
        },
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "interactive",
        sessionId: "interactive-no-chat",
      }),
    );

    expect(result.output).toContain("Output: —");
    expect(result.json).toMatchObject({
      operator: "interactive",
      mode: "detail",
      session: {
        agents: [
          {
            agentId: "agent-a",
            artifacts: [],
          },
        ],
      },
    });
  });

  it("returns the standard not-found detail payload for missing interactive sessions", async () => {
    const result = await executeListCommand(
      buildInput({
        operator: "interactive",
        sessionId: "interactive-missing",
      }),
    );

    expect(result.output).toBe(
      "interactive session `interactive-missing` not found.",
    );
    expect(result.json).toEqual({
      operator: "interactive",
      mode: "detail",
      session: null,
      warnings: [],
    });
  });

  function buildInput(params: {
    operator: "spec" | "run" | "reduce" | "verify" | "message" | "interactive";
    sessionId?: string;
    limit?: number;
    verbose?: boolean;
  }) {
    return {
      root: testDir,
      specsFilePath,
      runsFilePath,
      messagesFilePath,
      reductionsFilePath,
      verificationsFilePath,
      interactiveFilePath,
      operator: params.operator,
      sessionId: params.sessionId,
      limit: params.limit,
      verbose: params.verbose,
    };
  }
});

function buildRunRecord(params: {
  runId: string;
  status: RunRecord["status"];
  createdAt?: string;
  deletedAt?: string | null;
}): RunRecord {
  return createRunRecord({
    runId: params.runId,
    status: params.status,
    createdAt: params.createdAt ?? "2026-03-01T00:00:00.000Z",
    spec: { path: "specs/task.md" },
    agents: [
      {
        agentId: "agent-a",
        model: "model",
        status: params.status === "running" ? "running" : "succeeded",
        startedAt: "2026-03-01T00:00:00.000Z",
        completedAt:
          params.status === "running" ? undefined : "2026-03-01T00:05:00.000Z",
        artifacts:
          params.status === "running"
            ? undefined
            : {
                diffAttempted: true,
                diffCaptured: true,
              },
      },
    ],
    deletedAt: params.deletedAt ?? null,
  });
}

function buildInteractiveRecord(
  params: Partial<InteractiveSessionRecord> & {
    sessionId: string;
    status: InteractiveSessionRecord["status"];
  },
): InteractiveSessionRecord {
  return {
    sessionId: params.sessionId,
    createdAt: params.createdAt ?? "2026-03-01T00:00:00.000Z",
    status: params.status,
    agentId: params.agentId ?? "agent-a",
    toolAttachmentStatus: params.toolAttachmentStatus ?? "attached",
    ...(params.task ? { task: params.task } : {}),
    ...(params.chat ? { chat: params.chat } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
}

function buildSpecRecord(params: {
  sessionId: string;
  status: SpecRecord["status"];
  createdAt?: string;
  agents?: SpecRecord["agents"];
}): SpecRecord {
  const createdAt = params.createdAt ?? "2026-03-01T00:00:00.000Z";
  const startedAt = createdAt;
  const completedAt =
    params.status === "running" ? undefined : "2026-03-01T00:05:00.000Z";

  return {
    sessionId: params.sessionId,
    createdAt,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    status: params.status,
    description: "Generate task spec",
    agents:
      params.agents ??
      (params.status === "succeeded"
        ? [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt,
              completedAt,
              outputPath: `.voratiq/spec/sessions/${params.sessionId}/agent-a/artifacts/spec.md`,
              dataPath: `.voratiq/spec/sessions/${params.sessionId}/agent-a/artifacts/spec.json`,
            },
          ]
        : []),
    error: params.status === "failed" ? "failed" : null,
  };
}

function buildReductionRecord(params: {
  sessionId: string;
  status: ReductionRecord["status"];
  target: ReductionRecord["target"];
}): ReductionRecord {
  const createdAt = "2026-03-01T00:00:00.000Z";
  const startedAt = createdAt;
  const completedAt =
    params.status === "queued" || params.status === "running"
      ? undefined
      : "2026-03-01T00:05:00.000Z";
  const reducerStatus =
    params.status === "aborted"
      ? "aborted"
      : params.status === "failed"
        ? "failed"
        : "succeeded";
  const reducerCompletedAt = "2026-03-01T00:05:00.000Z";

  return {
    sessionId: params.sessionId,
    target: params.target,
    createdAt,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    status: params.status,
    reducers: [
      {
        agentId: "agent-a",
        status: reducerStatus,
        outputPath: `.voratiq/reduce/sessions/${params.sessionId}/agent-a/reduction.md`,
        dataPath: `.voratiq/reduce/sessions/${params.sessionId}/agent-a/reduction.json`,
        startedAt,
        ...(reducerCompletedAt ? { completedAt: reducerCompletedAt } : {}),
        error: reducerStatus === "failed" ? "failed" : null,
      },
    ],
    error: params.status === "failed" ? "failed" : null,
  };
}

function buildMessageRecord(params: {
  sessionId: string;
  status: MessageRecord["status"];
  target?: MessageRecord["target"];
  sourceInteractiveSessionId?: string;
  recipients?: MessageRecord["recipients"];
}): MessageRecord {
  const createdAt = "2026-03-01T00:00:00.000Z";
  const completedAt =
    params.status === "queued" || params.status === "running"
      ? undefined
      : "2026-03-01T00:05:00.000Z";

  return {
    sessionId: params.sessionId,
    createdAt,
    startedAt: createdAt,
    ...(completedAt ? { completedAt } : {}),
    status: params.status,
    prompt: "Review this change.",
    ...(params.target ? { target: params.target } : {}),
    ...(params.sourceInteractiveSessionId
      ? { sourceInteractiveSessionId: params.sourceInteractiveSessionId }
      : {}),
    recipients: params.recipients ?? [
      {
        agentId: "agent-a",
        status:
          params.status === "aborted"
            ? "aborted"
            : params.status === "failed"
              ? "failed"
              : params.status === "queued"
                ? "queued"
                : params.status === "running"
                  ? "running"
                  : "succeeded",
        startedAt: createdAt,
        ...(completedAt ? { completedAt } : {}),
        ...(params.status === "succeeded"
          ? {
              outputPath: `.voratiq/message/sessions/${params.sessionId}/agent-a/artifacts/response.md`,
            }
          : {}),
        error: params.status === "failed" ? "failed" : null,
      },
    ],
    error: params.status === "failed" ? "failed" : null,
  };
}

function buildVerificationRecord(params: {
  sessionId: string;
  status: VerificationRecord["status"];
  methods?: VerificationRecord["methods"];
}): VerificationRecord {
  const createdAt = "2026-03-01T00:00:00.000Z";
  const startedAt = createdAt;
  const completedAt =
    params.status === "queued" || params.status === "running"
      ? undefined
      : "2026-03-01T00:05:00.000Z";

  return {
    sessionId: params.sessionId,
    createdAt,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    status: params.status,
    target: {
      kind: "run",
      sessionId: "run-123",
      candidateIds: ["agent-a"],
    },
    methods: params.methods ?? [],
    error: params.status === "failed" ? "failed" : null,
  };
}

function findDetailTableRow(
  output: string | undefined,
  label: string,
  status: string,
): string {
  if (!output) {
    throw new Error("Expected detail transcript output");
  }
  const row = output
    .split("\n")
    .find((line) => line.includes(label) && line.includes(status));
  if (!row) {
    throw new Error(`Expected detail row for ${label} with status ${status}`);
  }
  return row;
}
