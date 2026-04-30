import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { executeListCommand } from "../../../src/commands/list/command.js";
import {
  formatTargetTablePreview,
  TARGET_TABLE_PREVIEW_LENGTH,
} from "../../../src/commands/list/normalization.js";
import { parseListJsonOutput } from "../../../src/contracts/list.js";
import type { InteractiveSessionRecord } from "../../../src/domain/interactive/model/types.js";
import { appendInteractiveSessionRecord } from "../../../src/domain/interactive/persistence/adapter.js";
import type { MessageRecord } from "../../../src/domain/message/model/types.js";
import { appendMessageRecord } from "../../../src/domain/message/persistence/adapter.js";
import type { ReductionRecord } from "../../../src/domain/reduce/model/types.js";
import { appendReductionRecord } from "../../../src/domain/reduce/persistence/adapter.js";
import type { RunRecord } from "../../../src/domain/run/model/types.js";
import {
  appendRunRecord,
  type ReadRunRecordsOptions,
} from "../../../src/domain/run/persistence/adapter.js";
import type { SpecRecord } from "../../../src/domain/spec/model/types.js";
import { appendSpecRecord } from "../../../src/domain/spec/persistence/adapter.js";
import type { VerificationRecord } from "../../../src/domain/verify/model/types.js";
import { appendVerificationRecord } from "../../../src/domain/verify/persistence/adapter.js";
import { formatRunTimestamp } from "../../../src/render/utils/records.js";
import { createRunRecord } from "../../support/factories/run-records.js";
import {
  resetReadRunRecordsImplementation,
  setReadRunRecordsImplementation,
} from "../../support/hooks/run-records.js";

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

  it("renders run summary view with only aborted runs hidden by default", async () => {
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

    expect(result.mode).toBe("summary");
    expect(result.output).toContain("RUN");
    expect(result.output).toContain("TARGET");
    expect(result.output).toContain("STATUS");
    expect(result.output).toContain("CREATED");
    expect(result.output).toContain("run-visible");
    expect(result.output).toContain("file:specs/task.md");
    expect(result.output).not.toContain("run-aborted");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "summary",
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

  it("includes run aborted statuses with --all-statuses", async () => {
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
        runId: "run-aborted",
        status: "aborted",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        allStatuses: true,
      }),
    );

    expect(result.output).toContain("run-visible");
    expect(result.output).toContain("run-aborted");
    expect(result.output).toContain("SUCCEEDED");
    expect(result.output).toContain("ABORTED");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "summary",
      sessions: [{ sessionId: "run-aborted" }, { sessionId: "run-visible" }],
    });
  });

  it("applies --limit after default filtering in summary mode", async () => {
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
      mode: "summary",
      sessions: [{ sessionId: "run-visible-newest" }],
    });
  });

  it("renders compact run detail by default", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-succeeded",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        sessionId: "run-succeeded",
      }),
    );

    expect(result.mode).toBe("detail");
    expect(result.output).toContain("run-succeeded");
    expect(result.output).toContain("SUCCEEDED");
    expect(result.output).toContain("Workspace");
    expect(result.output).toContain("Target");
    expect(result.output).toContain("file:specs/task.md");
    expect(result.output).toContain("AGENT");
    expect(findDetailTableRow(result.output, "agent-a", "SUCCEEDED")).toContain(
      "5m",
    );
    expect(result.output).not.toContain("Agent: agent-a");
    expect(result.output).not.toContain(
      "Output: .voratiq/run/sessions/run-succeeded/agent-a/artifacts/diff.patch",
    );
    expect(result.output).not.toContain("Base Revision");
    expect(result.output).not.toContain("\nSpec");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "detail",
      session: {
        sessionId: "run-succeeded",
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
                path: ".voratiq/run/sessions/run-succeeded/agent-a/artifacts/diff.patch",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("renders expanded run detail with --verbose", async () => {
    await appendRunRecord({
      root: testDir,
      runsFilePath,
      record: buildRunRecord({
        runId: "run-verbose-detail",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "run",
        sessionId: "run-verbose-detail",
        verbose: true,
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/run/sessions/run-verbose-detail/agent-a/artifacts/diff.patch",
    );
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

    const summaryResult = await executeListCommand(
      buildInput({
        operator: "run",
      }),
    );

    expect(summaryResult.output).toContain("spec:spec-123");
    expect(summaryResult.json).toMatchObject({
      operator: "run",
      mode: "summary",
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
    expect(
      findDetailTableRow(detailResult.output, "agent-a", "SUCCEEDED"),
    ).toContain("5m");
    expect(detailResult.output).not.toContain(
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

  it("keeps compact run detail focused on metadata and the status table when diff artifacts are missing", async () => {
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

    expect(findDetailTableRow(result.output, "agent-a", "SUCCEEDED")).toContain(
      "5m",
    );
    expect(result.output).not.toContain("Agent: agent-a");
    expect(result.output).not.toContain("Output: —");
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
      mode: "summary",
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
      mode: "summary",
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

  it("renders spec summary with default aborted filtering and --all-statuses", async () => {
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

    const allStatusesResult = await executeListCommand(
      buildInput({
        operator: "spec",
        allStatuses: true,
      }),
    );
    expect(allStatusesResult.output).toContain("spec-visible");
    expect(allStatusesResult.output).toContain("spec-aborted");
    expect(allStatusesResult.output).toContain("ABORTED");
    expect(allStatusesResult.json).toMatchObject({
      operator: "spec",
      mode: "summary",
    });
    expect(allStatusesResult.json.mode).toBe("summary");
    if (allStatusesResult.json.mode !== "summary") {
      throw new Error("Expected list-mode JSON output");
    }
    expect(allStatusesResult.json.sessions).toEqual(
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
      mode: "summary",
    });
    if (result.json.mode !== "summary") {
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
    expect(findDetailTableRow(result.output, "agent-a", "FAILED")).toContain(
      "5m",
    );
    expect(result.output).not.toContain("Description");
    expect(result.output).not.toContain("Agent: agent-a");
    expect(result.output).not.toContain("Output:");
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

  it("renders expanded spec detail with --verbose", async () => {
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-verbose",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "spec",
        sessionId: "spec-verbose",
        verbose: true,
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/spec/sessions/spec-verbose/agent-a/artifacts/spec.md",
    );
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
      mode: "summary",
    });
    if (result.json.mode !== "summary") {
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

  it("keeps compact spec detail focused on metadata and the status table when artifacts are missing", async () => {
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

    expect(findDetailTableRow(result.output, "agent-a", "RUNNING")).toContain(
      "—",
    );
    expect(result.output).not.toContain("Agent: agent-a");
    expect(result.output).not.toContain("Output: —");
  });

  it("renders reduce summary with TARGET column and aborted filtering", async () => {
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

    const allStatusesResult = await executeListCommand(
      buildInput({
        operator: "reduce",
        allStatuses: true,
      }),
    );
    expect(allStatusesResult.output).toContain("reduce-aborted");
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
    expect(result.output).not.toContain("Agent: agent-a");
    expect(result.output).not.toContain("Output:");
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

  it("renders expanded reduce detail with --verbose", async () => {
    const reduction = buildReductionRecord({
      sessionId: "reduce-verbose",
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
        sessionId: "reduce-verbose",
        verbose: true,
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/reduce/sessions/reduce-verbose/agent-a/reduction.md",
    );
  });

  it("renders message summary with TARGET values and without a recipients column", async () => {
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
      mode: "summary",
    });
    if (defaultResult.json.mode !== "summary") {
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

    const allStatusesResult = await executeListCommand(
      buildInput({
        operator: "message",
        allStatuses: true,
      }),
    );
    expect(allStatusesResult.output).toContain("message-aborted");
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
      mode: "summary",
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

  it("renders compact message detail like other operator detail views", async () => {
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
    expect(result.output).not.toContain("Agent: agent-a");
    expect(result.output).not.toContain("Output:");
    expect(result.output).not.toContain("Request:");
    expect(result.output).not.toContain("Response:");
    expect(result.output).not.toContain("Response data:");
    expect(result.output).not.toContain("\nStatus: ");
    expect(result.output).not.toContain("\nDuration: ");
    expect(result.output).not.toContain("Target:");
    expect(result.output).not.toContain("\n---\n");
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

  it("renders expanded message detail with --verbose", async () => {
    await appendMessageRecord({
      root: testDir,
      messagesFilePath,
      record: buildMessageRecord({
        sessionId: "message-verbose",
        status: "succeeded",
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "message",
        sessionId: "message-verbose",
        verbose: true,
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/message/sessions/message-verbose/agent-a/artifacts/response.md",
    );
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

    const summaryResult = await executeListCommand(
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

    expect(summaryResult.output).toContain("run:run-123:gpt-5-4-high");
    expect(summaryResult.json).toMatchObject({
      operator: "message",
      mode: "summary",
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
    expect(result.json.session).not.toHaveProperty("selection");
  });

  it("renders verify summary with TARGET column and aborted filtering", async () => {
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

    const allStatusesResult = await executeListCommand(
      buildInput({
        operator: "verify",
        allStatuses: true,
      }),
    );
    expect(allStatusesResult.output).toContain("verify-aborted");
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
    expect(result.output).toMatch(/Target\s+run:run-123/u);
    expect(result.output).not.toContain("Agent: —");
    expect(result.output).not.toContain("Output:");
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

  it("exposes a decision-only resolvable run verification selection", async () => {
    const artifactPath =
      ".voratiq/verify/sessions/verify-select-run/verifier-a/run-verification/artifacts/result.json";
    await writeVerificationArtifact(testDir, artifactPath, {
      method: "rubric",
      template: "run-verification",
      verifierId: "verifier-a",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "succeeded",
      result: {
        preferred: "v_aaaaaaaaaa",
        ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
      },
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: {
        ...buildVerificationRecord({
          sessionId: "verify-select-run",
          status: "succeeded",
          methods: [
            {
              method: "rubric",
              template: "run-verification",
              verifierId: "verifier-a",
              scope: { kind: "run" },
              status: "succeeded",
              artifactPath,
              startedAt: "2026-03-01T00:00:00.000Z",
              completedAt: "2026-03-01T00:01:00.000Z",
            },
          ],
        }),
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-select-run",
      }),
    );
    const parsed = parseListJsonOutput(result.json);

    expect(parsed).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        status: "succeeded",
      },
    });
    if (parsed.mode !== "detail" || !parsed.session) {
      throw new Error("Expected detail output");
    }
    expect(parsed.session.selection).toEqual({
      state: "resolvable",
      selectedCanonicalAgentId: "agent-a",
    });
  });

  it("rejects resolved verification selection fields outside the decision payload", () => {
    const baseOutput = {
      operator: "verify",
      mode: "detail",
      session: {
        operator: "verify",
        sessionId: "verify-legacy-selection",
        status: "succeeded",
        createdAt: "2026-03-01T00:00:00.000Z",
        workspacePath: ".voratiq/verify/sessions/verify-legacy-selection",
        target: {
          kind: "run",
          sessionId: "run-123",
        },
        agents: [],
      },
      warnings: [],
    };
    const extraFields = [
      { unresolvedReasons: [] },
      { runId: "run-123" },
      { agentId: "agent-a" },
      {
        specPath: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
      },
    ];

    for (const extraField of extraFields) {
      expect(() =>
        parseListJsonOutput({
          ...baseOutput,
          session: {
            ...baseOutput.session,
            selection: {
              state: "resolvable",
              selectedCanonicalAgentId: "agent-a",
              ...extraField,
            },
          },
        }),
      ).toThrow();
    }
  });

  it("requires unresolved reasons only for unresolved verification selections", () => {
    expect(() =>
      parseListJsonOutput({
        operator: "verify",
        mode: "detail",
        session: {
          operator: "verify",
          sessionId: "verify-missing-unresolved-reasons",
          status: "succeeded",
          createdAt: "2026-03-01T00:00:00.000Z",
          workspacePath:
            ".voratiq/verify/sessions/verify-missing-unresolved-reasons",
          target: {
            kind: "run",
            sessionId: "run-123",
          },
          agents: [],
          selection: {
            state: "unresolved",
          },
        },
        warnings: [],
      }),
    ).toThrow();
  });

  it("exposes a decision-only resolvable spec verification selection", async () => {
    const artifactPath =
      ".voratiq/verify/sessions/verify-select-spec/verifier-a/spec-verification/artifacts/result.json";
    const specPath =
      ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md";
    await writeVerificationArtifact(testDir, artifactPath, {
      method: "rubric",
      template: "spec-verification",
      verifierId: "verifier-a",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "succeeded",
      result: {
        preferred: "v_aaaaaaaaaa",
        ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
      },
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: {
        ...buildVerificationRecord({
          sessionId: "verify-select-spec",
          status: "succeeded",
          methods: [
            {
              method: "rubric",
              template: "spec-verification",
              verifierId: "verifier-a",
              scope: { kind: "target" },
              status: "succeeded",
              artifactPath,
              startedAt: "2026-03-01T00:00:00.000Z",
              completedAt: "2026-03-01T00:01:00.000Z",
            },
          ],
        }),
        target: {
          kind: "spec",
          sessionId: "spec-123",
          specPath,
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-select-spec",
      }),
    );

    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail output");
    }
    expect(result.json.session.selection).toEqual({
      state: "resolvable",
      selectedCanonicalAgentId: "agent-a",
    });
  });

  it("exposes generic resolvable verification selections across target kinds", async () => {
    const cases = [
      {
        name: "spec",
        target: {
          kind: "spec",
          sessionId: "spec-generic-target",
        },
        template: "spec-verification",
        scope: { kind: "target" },
      },
      {
        name: "run",
        target: {
          kind: "run",
          sessionId: "run-generic-target",
          candidateIds: ["agent-a", "agent-b"],
        },
        template: "run-verification",
        scope: { kind: "run" },
      },
      {
        name: "reduce",
        target: {
          kind: "reduce",
          sessionId: "reduce-generic-target",
        },
        template: "reduce-verification",
        scope: { kind: "target" },
      },
      {
        name: "message",
        target: {
          kind: "message",
          sessionId: "message-generic-target",
        },
        template: "message-verification",
        scope: { kind: "target" },
      },
    ] satisfies ReadonlyArray<{
      name: string;
      target: VerificationRecord["target"];
      template: string;
      scope: VerificationRecord["methods"][number]["scope"];
    }>;

    for (const selectionCase of cases) {
      const artifactPath = `.voratiq/verify/sessions/verify-generic-${selectionCase.name}/verifier-a/${selectionCase.template}/artifacts/result.json`;
      await writeVerificationArtifact(testDir, artifactPath, {
        method: "rubric",
        template: selectionCase.template,
        verifierId: "verifier-a",
        generatedAt: "2026-03-01T00:05:00.000Z",
        status: "succeeded",
        result: {
          preferred: "v_aaaaaaaaaa",
          ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
        },
      });
      await appendVerificationRecord({
        root: testDir,
        verificationsFilePath,
        record: {
          ...buildVerificationRecord({
            sessionId: `verify-generic-${selectionCase.name}`,
            status: "succeeded",
            methods: [
              {
                method: "rubric",
                template: selectionCase.template,
                verifierId: "verifier-a",
                scope: selectionCase.scope,
                status: "succeeded",
                artifactPath,
                startedAt: "2026-03-01T00:00:00.000Z",
                completedAt: "2026-03-01T00:01:00.000Z",
              },
            ],
          }),
          target: selectionCase.target,
          blinded: {
            enabled: true,
            aliasMap: {
              v_aaaaaaaaaa: "agent-a",
              v_bbbbbbbbbb: "agent-b",
            },
          },
        },
      });

      const result = await executeListCommand(
        buildInput({
          operator: "verify",
          sessionId: `verify-generic-${selectionCase.name}`,
        }),
      );

      expect(result.json).toMatchObject({
        operator: "verify",
        mode: "detail",
        session: {
          target: {
            kind: selectionCase.target.kind,
            sessionId: selectionCase.target.sessionId,
          },
        },
      });
      if (result.json.mode !== "detail" || !result.json.session) {
        throw new Error("Expected detail output");
      }
      expect(result.json.session.selection).toEqual({
        state: "resolvable",
        selectedCanonicalAgentId: "agent-a",
      });
    }
  });

  it("does not include recoverable spec paths in resolvable selections", async () => {
    const artifactPath =
      ".voratiq/verify/sessions/verify-recover-spec/verifier-a/spec-verification/artifacts/result.json";
    const selectedSpecPath =
      ".voratiq/spec/sessions/spec-recover/agent-a/artifacts/spec.md";
    await appendSpecRecord({
      root: testDir,
      specsFilePath,
      record: buildSpecRecord({
        sessionId: "spec-recover",
        status: "succeeded",
        agents: [
          {
            agentId: "agent-a",
            status: "succeeded",
            startedAt: "2026-03-01T00:00:00.000Z",
            completedAt: "2026-03-01T00:01:00.000Z",
            outputPath: selectedSpecPath,
            dataPath:
              ".voratiq/spec/sessions/spec-recover/agent-a/artifacts/spec.json",
          },
          {
            agentId: "agent-b",
            status: "succeeded",
            startedAt: "2026-03-01T00:00:00.000Z",
            completedAt: "2026-03-01T00:01:00.000Z",
            outputPath:
              ".voratiq/spec/sessions/spec-recover/agent-b/artifacts/spec.md",
            dataPath:
              ".voratiq/spec/sessions/spec-recover/agent-b/artifacts/spec.json",
          },
        ],
      }),
    });
    await writeVerificationArtifact(testDir, artifactPath, {
      method: "rubric",
      template: "spec-verification",
      verifierId: "verifier-a",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "succeeded",
      result: {
        preferred: "v_aaaaaaaaaa",
        ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
      },
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: {
        ...buildVerificationRecord({
          sessionId: "verify-recover-spec",
          status: "succeeded",
          methods: [
            {
              method: "rubric",
              template: "spec-verification",
              verifierId: "verifier-a",
              scope: { kind: "target" },
              status: "succeeded",
              artifactPath,
              startedAt: "2026-03-01T00:00:00.000Z",
              completedAt: "2026-03-01T00:01:00.000Z",
            },
          ],
        }),
        target: {
          kind: "spec",
          sessionId: "spec-recover",
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-recover-spec",
      }),
    );

    expect(result.json).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        status: "succeeded",
      },
    });
    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail output");
    }
    expect(result.json.session.selection).toEqual({
      state: "resolvable",
      selectedCanonicalAgentId: "agent-a",
    });
  });

  it("keeps resolved spec selections generic when the selected spec path is unavailable", async () => {
    const artifactPath =
      ".voratiq/verify/sessions/verify-spec-missing-path/verifier-a/spec-verification/artifacts/result.json";
    await writeVerificationArtifact(testDir, artifactPath, {
      method: "rubric",
      template: "spec-verification",
      verifierId: "verifier-a",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "succeeded",
      result: {
        preferred: "v_aaaaaaaaaa",
        ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
      },
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: {
        ...buildVerificationRecord({
          sessionId: "verify-spec-missing-path",
          status: "succeeded",
          methods: [
            {
              method: "rubric",
              template: "spec-verification",
              verifierId: "verifier-a",
              scope: { kind: "target" },
              status: "succeeded",
              artifactPath,
              startedAt: "2026-03-01T00:00:00.000Z",
              completedAt: "2026-03-01T00:01:00.000Z",
            },
          ],
        }),
        target: {
          kind: "spec",
          sessionId: "spec-missing-path",
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-spec-missing-path",
      }),
    );

    expect(result.json).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        status: "succeeded",
      },
    });
    if (result.json.mode !== "detail" || !result.json.session) {
      throw new Error("Expected detail output");
    }
    expect(result.json.session.selection).toEqual({
      state: "resolvable",
      selectedCanonicalAgentId: "agent-a",
    });
  });

  it("keeps verifier disagreement as an unresolved selection while status stays succeeded", async () => {
    const verifierAPath =
      ".voratiq/verify/sessions/verify-disagreement/verifier-a/run-verification/artifacts/result.json";
    const verifierBPath =
      ".voratiq/verify/sessions/verify-disagreement/verifier-b/run-verification/artifacts/result.json";
    await writeVerificationArtifact(testDir, verifierAPath, {
      method: "rubric",
      template: "run-verification",
      verifierId: "verifier-a",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "succeeded",
      result: {
        preferred: "v_aaaaaaaaaa",
        ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
      },
    });
    await writeVerificationArtifact(testDir, verifierBPath, {
      method: "rubric",
      template: "run-verification",
      verifierId: "verifier-b",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "succeeded",
      result: {
        preferred: "v_bbbbbbbbbb",
        ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
      },
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: {
        ...buildVerificationRecord({
          sessionId: "verify-disagreement",
          status: "succeeded",
          methods: [
            {
              method: "rubric",
              template: "run-verification",
              verifierId: "verifier-a",
              scope: { kind: "run" },
              status: "succeeded",
              artifactPath: verifierAPath,
              startedAt: "2026-03-01T00:00:00.000Z",
              completedAt: "2026-03-01T00:01:00.000Z",
            },
            {
              method: "rubric",
              template: "run-verification",
              verifierId: "verifier-b",
              scope: { kind: "run" },
              status: "succeeded",
              artifactPath: verifierBPath,
              startedAt: "2026-03-01T00:00:00.000Z",
              completedAt: "2026-03-01T00:01:00.000Z",
            },
          ],
        }),
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
      },
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-disagreement",
      }),
    );
    const parsed = parseListJsonOutput(result.json);

    expect(parsed).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        status: "succeeded",
        selection: {
          state: "unresolved",
          unresolvedReasons: [
            {
              code: "verifier_disagreement",
              selections: [
                {
                  verifierAgentId: "verifier-a",
                  selectedCanonicalAgentId: "agent-a",
                },
                {
                  verifierAgentId: "verifier-b",
                  selectedCanonicalAgentId: "agent-b",
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("exposes generic unresolved verification selections across non-run target kinds", async () => {
    const cases = [
      {
        name: "spec",
        target: {
          kind: "spec",
          sessionId: "spec-unresolved-target",
        },
        template: "spec-verification",
      },
      {
        name: "reduce",
        target: {
          kind: "reduce",
          sessionId: "reduce-unresolved-target",
        },
        template: "reduce-verification",
      },
      {
        name: "message",
        target: {
          kind: "message",
          sessionId: "message-unresolved-target",
        },
        template: "message-verification",
      },
    ] satisfies ReadonlyArray<{
      name: string;
      target: VerificationRecord["target"];
      template: string;
    }>;

    for (const selectionCase of cases) {
      const verifierAPath = `.voratiq/verify/sessions/verify-unresolved-${selectionCase.name}/verifier-a/${selectionCase.template}/artifacts/result.json`;
      const verifierBPath = `.voratiq/verify/sessions/verify-unresolved-${selectionCase.name}/verifier-b/${selectionCase.template}/artifacts/result.json`;
      await writeVerificationArtifact(testDir, verifierAPath, {
        method: "rubric",
        template: selectionCase.template,
        verifierId: "verifier-a",
        generatedAt: "2026-03-01T00:05:00.000Z",
        status: "succeeded",
        result: {
          preferred: "v_aaaaaaaaaa",
          ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
        },
      });
      await writeVerificationArtifact(testDir, verifierBPath, {
        method: "rubric",
        template: selectionCase.template,
        verifierId: "verifier-b",
        generatedAt: "2026-03-01T00:05:00.000Z",
        status: "succeeded",
        result: {
          preferred: "v_bbbbbbbbbb",
          ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
        },
      });
      await appendVerificationRecord({
        root: testDir,
        verificationsFilePath,
        record: {
          ...buildVerificationRecord({
            sessionId: `verify-unresolved-${selectionCase.name}`,
            status: "succeeded",
            methods: [
              {
                method: "rubric",
                template: selectionCase.template,
                verifierId: "verifier-a",
                scope: { kind: "target" },
                status: "succeeded",
                artifactPath: verifierAPath,
                startedAt: "2026-03-01T00:00:00.000Z",
                completedAt: "2026-03-01T00:01:00.000Z",
              },
              {
                method: "rubric",
                template: selectionCase.template,
                verifierId: "verifier-b",
                scope: { kind: "target" },
                status: "succeeded",
                artifactPath: verifierBPath,
                startedAt: "2026-03-01T00:00:00.000Z",
                completedAt: "2026-03-01T00:01:00.000Z",
              },
            ],
          }),
          target: selectionCase.target,
          blinded: {
            enabled: true,
            aliasMap: {
              v_aaaaaaaaaa: "agent-a",
              v_bbbbbbbbbb: "agent-b",
            },
          },
        },
      });

      const result = await executeListCommand(
        buildInput({
          operator: "verify",
          sessionId: `verify-unresolved-${selectionCase.name}`,
        }),
      );

      expect(result.json).toMatchObject({
        operator: "verify",
        mode: "detail",
        session: {
          target: {
            kind: selectionCase.target.kind,
            sessionId: selectionCase.target.sessionId,
          },
          selection: {
            state: "unresolved",
            unresolvedReasons: [
              {
                code: "verifier_disagreement",
                selections: [
                  {
                    verifierAgentId: "verifier-a",
                    selectedCanonicalAgentId: "agent-a",
                  },
                  {
                    verifierAgentId: "verifier-b",
                    selectedCanonicalAgentId: "agent-b",
                  },
                ],
              },
            ],
          },
        },
      });
    }
  });

  it("exposes no-successful-verifiers when all selection verifiers failed", async () => {
    const programmaticPath =
      ".voratiq/verify/sessions/verify-no-successful/programmatic/artifacts/result.json";
    const rubricPath =
      ".voratiq/verify/sessions/verify-no-successful/verifier-a/run-verification/artifacts/result.json";
    await writeVerificationArtifact(testDir, programmaticPath, {
      method: "programmatic",
      generatedAt: "2026-03-01T00:05:00.000Z",
      target: {
        kind: "run",
        sessionId: "run-123",
        candidateIds: ["agent-a"],
      },
      scope: "run",
      candidates: [
        {
          candidateId: "agent-a",
          results: [
            {
              slug: "tests",
              status: "succeeded",
              exitCode: 0,
            },
          ],
        },
      ],
    });
    await writeVerificationArtifact(testDir, rubricPath, {
      method: "rubric",
      template: "run-verification",
      verifierId: "verifier-a",
      generatedAt: "2026-03-01T00:05:00.000Z",
      status: "failed",
      result: {
        preferred: "agent-a",
        ranking: ["agent-a"],
      },
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-no-successful",
        status: "succeeded",
        methods: [
          {
            method: "programmatic",
            slug: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath: programmaticPath,
            startedAt: "2026-03-01T00:00:00.000Z",
            completedAt: "2026-03-01T00:01:00.000Z",
          },
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "verifier-a",
            scope: { kind: "run" },
            status: "failed",
            artifactPath: rubricPath,
            startedAt: "2026-03-01T00:00:00.000Z",
            completedAt: "2026-03-01T00:01:00.000Z",
          },
        ],
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-no-successful",
      }),
    );

    expect(result.json).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        status: "succeeded",
        selection: {
          state: "unresolved",
          unresolvedReasons: [
            {
              code: "no_successful_verifiers",
              failedVerifierAgentIds: ["verifier-a"],
            },
          ],
        },
      },
    });
  });

  it("exposes unresolved lifecycle state for terminal verify sessions without a resolvable selection", async () => {
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-no-methods",
        status: "succeeded",
        methods: [],
      }),
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-running-no-methods",
        status: "running",
        methods: [],
      }),
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-failed-no-methods",
        status: "failed",
        methods: [],
      }),
    });
    await appendVerificationRecord({
      root: testDir,
      verificationsFilePath,
      record: buildVerificationRecord({
        sessionId: "verify-aborted-no-methods",
        status: "aborted",
        methods: [],
      }),
    });

    const succeededResult = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-no-methods",
      }),
    );
    const runningResult = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-running-no-methods",
      }),
    );
    const failedResult = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-failed-no-methods",
      }),
    );
    const abortedResult = await executeListCommand(
      buildInput({
        operator: "verify",
        sessionId: "verify-aborted-no-methods",
      }),
    );

    expect(succeededResult.json).toMatchObject({
      operator: "verify",
      mode: "detail",
      session: {
        status: "succeeded",
        selection: {
          state: "unresolved",
          unresolvedReasons: [
            {
              code: "no_successful_verifiers",
              failedVerifierAgentIds: [],
            },
          ],
        },
      },
    });
    if (
      runningResult.json.mode !== "detail" ||
      !runningResult.json.session ||
      failedResult.json.mode !== "detail" ||
      !failedResult.json.session ||
      abortedResult.json.mode !== "detail" ||
      !abortedResult.json.session
    ) {
      throw new Error("Expected detail-mode verify json output");
    }
    expect(runningResult.json.session).not.toHaveProperty("selection");
    expect(failedResult.json.session.selection).toEqual({
      state: "unresolved",
      unresolvedReasons: [
        {
          code: "verification_not_succeeded",
          status: "failed",
        },
      ],
    });
    expect(abortedResult.json.session.selection).toEqual({
      state: "unresolved",
      unresolvedReasons: [
        {
          code: "verification_not_succeeded",
          status: "aborted",
        },
      ],
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

  it("renders expanded verify detail with --verbose", async () => {
    const verification = buildVerificationRecord({
      sessionId: "verify-verbose",
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
            ".voratiq/verify/sessions/verify-verbose/programmatic/artifacts/result.json",
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
        sessionId: "verify-verbose",
        verbose: true,
      }),
    );

    expect(result.output).toContain("Agent: —");
    expect(result.output).toContain(
      "Output: .voratiq/verify/sessions/verify-verbose/programmatic/artifacts/result.json",
    );
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
    expect(result.json.session.selection).toEqual({
      state: "unresolved",
      unresolvedReasons: [
        {
          code: "no_successful_verifiers",
          failedVerifierAgentIds: [],
        },
      ],
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

  it("renders interactive summary output through the shared list pipeline", async () => {
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
      mode: "summary",
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

  it("applies interactive default filtering, --all-statuses, and limit in summary mode", async () => {
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
      mode: "summary",
      sessions: [
        { sessionId: "interactive-newest" },
        { sessionId: "interactive-failed" },
      ],
    });

    const allStatusesResult = await executeListCommand(
      buildInput({
        operator: "interactive",
        allStatuses: true,
      }),
    );

    expect(allStatusesResult.output).toContain("interactive-oldest");
    expect(allStatusesResult.output).toContain("interactive-failed");
    expect(allStatusesResult.output).toContain("interactive-newest");
  });

  it("renders interactive detail output and json without target metadata", async () => {
    const createdAt = "2026-03-01T00:00:00.000Z";
    const completedAt = "2026-03-01T00:05:00.000Z";
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-detail",
        status: "succeeded",
        createdAt,
        completedAt,
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
    expect(result.output).toMatch(/Elapsed\s+5m/u);
    expect(result.output).toContain(
      `Created    ${formatRunTimestamp(createdAt)}`,
    );
    expect(result.output).toMatch(
      /Workspace\s+\.voratiq\/interactive\/sessions\/interactive-detail/u,
    );
    expect(result.output).not.toContain("Target");
    expect(result.output).toContain("AGENT");
    expect(result.output).toContain("agent-a");
    expect(result.output).not.toContain(
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
        startedAt: "2026-03-01T00:00:00.000Z",
        completedAt: "2026-03-01T00:05:00.000Z",
        workspacePath: ".voratiq/interactive/sessions/interactive-detail",
        agents: [
          {
            agentId: "agent-a",
            status: "succeeded",
            startedAt: "2026-03-01T00:00:00.000Z",
            completedAt: "2026-03-01T00:05:00.000Z",
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

  it("renders expanded interactive detail with --verbose", async () => {
    await appendInteractiveSessionRecord({
      root: testDir,
      record: buildInteractiveRecord({
        sessionId: "interactive-verbose",
        status: "succeeded",
        chat: {
          captured: true,
          format: "jsonl",
          artifactPath:
            ".voratiq/interactive/sessions/interactive-verbose/artifacts/chat.jsonl",
        },
      }),
    });

    const result = await executeListCommand(
      buildInput({
        operator: "interactive",
        sessionId: "interactive-verbose",
        verbose: true,
      }),
    );

    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain(
      "Output: .voratiq/interactive/sessions/interactive-verbose/artifacts/chat.jsonl",
    );
  });

  it("keeps compact interactive detail focused on metadata and the status table when chat is missing", async () => {
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

    expect(result.output).not.toContain("Output: —");
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

  describe("bounded read path", () => {
    let capturedOptions: ReadRunRecordsOptions | undefined;

    afterEach(() => {
      resetReadRunRecordsImplementation();
      capturedOptions = undefined;
    });

    it("passes limit and default-filter predicate to readRunRecords in default summary mode", async () => {
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-bounded-setup",
          status: "succeeded",
        }),
      });

      setReadRunRecordsImplementation((options) => {
        capturedOptions = options;
        return Promise.resolve([]);
      });

      await executeListCommand(buildInput({ operator: "run", limit: 3 }));

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.limit).toBe(3);
      expect(typeof capturedOptions!.predicate).toBe("function");
    });

    it("passes limit without predicate when --all-statuses disables summary filtering", async () => {
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-verbose-setup",
          status: "succeeded",
        }),
      });

      setReadRunRecordsImplementation((options) => {
        capturedOptions = options;
        return Promise.resolve([]);
      });

      await executeListCommand(
        buildInput({ operator: "run", limit: 5, allStatuses: true }),
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.limit).toBe(5);
      expect(capturedOptions!.predicate).toBeUndefined();
    });

    it("default-filter predicate excludes aborted statuses", async () => {
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-predicate-setup",
          status: "succeeded",
        }),
      });

      setReadRunRecordsImplementation((options) => {
        capturedOptions = options;
        return Promise.resolve([]);
      });

      await executeListCommand(buildInput({ operator: "run" }));

      const predicate = capturedOptions!.predicate!;
      const visible = buildRunRecord({
        runId: "test",
        status: "succeeded",
      });
      const aborted = buildRunRecord({
        runId: "test",
        status: "aborted",
      });

      expect(predicate(visible)).toBe(true);
      expect(predicate(aborted)).toBe(false);
    });

    it("detail mode does not use the table-mode bounded predicate", async () => {
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-detail-setup",
          status: "succeeded",
        }),
      });

      setReadRunRecordsImplementation((options) => {
        capturedOptions = options;
        return Promise.resolve([]);
      });

      await executeListCommand(
        buildInput({ operator: "run", sessionId: "run-detail-setup" }),
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.limit).toBe(1);
      expect(typeof capturedOptions!.predicate).toBe("function");

      const matched = buildRunRecord({
        runId: "run-detail-setup",
        status: "succeeded",
      });
      const unmatched = buildRunRecord({
        runId: "other-run",
        status: "succeeded",
      });
      expect(capturedOptions!.predicate!(matched)).toBe(true);
      expect(capturedOptions!.predicate!(unmatched)).toBe(false);
    });

    it("bounds on visible rows rather than raw scanned rows", async () => {
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-visible-1",
          status: "succeeded",
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      });
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-visible-2",
          status: "succeeded",
          createdAt: "2026-03-01T00:01:00.000Z",
        }),
      });
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-aborted-1",
          status: "aborted",
          createdAt: "2026-03-01T00:02:00.000Z",
        }),
      });
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-aborted-2",
          status: "aborted",
          createdAt: "2026-03-01T00:03:00.000Z",
        }),
      });
      await appendRunRecord({
        root: testDir,
        runsFilePath,
        record: buildRunRecord({
          runId: "run-visible-3",
          status: "succeeded",
          createdAt: "2026-03-01T00:04:00.000Z",
        }),
      });

      const result = await executeListCommand(
        buildInput({ operator: "run", limit: 2 }),
      );

      expect(result.json).toMatchObject({
        operator: "run",
        mode: "summary",
        sessions: [
          { sessionId: "run-visible-3" },
          { sessionId: "run-visible-2" },
        ],
      });
      if (result.json.mode !== "summary") {
        throw new Error("Expected list-mode JSON output");
      }
      expect(result.json.sessions).toHaveLength(2);
    });
  });

  function buildInput(params: {
    operator: "spec" | "run" | "reduce" | "verify" | "message" | "interactive";
    sessionId?: string;
    limit?: number;
    allStatuses?: boolean;
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
      allStatuses: params.allStatuses,
      verbose: params.verbose,
    };
  }
});

function buildRunRecord(params: {
  runId: string;
  status: RunRecord["status"];
  createdAt?: string;
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
  });
}

function buildInteractiveRecord(
  params: Partial<InteractiveSessionRecord> & {
    sessionId: string;
    status: InteractiveSessionRecord["status"];
  },
): InteractiveSessionRecord {
  const createdAt = params.createdAt ?? "2026-03-01T00:00:00.000Z";
  const startedAt = params.startedAt ?? createdAt;
  const completedAt =
    params.completedAt ??
    (params.status === "running" ? undefined : "2026-03-01T00:05:00.000Z");
  return {
    sessionId: params.sessionId,
    createdAt,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
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

async function writeVerificationArtifact(
  root: string,
  artifactPath: string,
  value: unknown,
): Promise<void> {
  const absolutePath = join(root, artifactPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(value, null, 2), "utf8");
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
