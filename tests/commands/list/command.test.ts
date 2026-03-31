import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeListCommand } from "../../../src/commands/list/command.js";
import type { ReductionRecord } from "../../../src/domain/reduce/model/types.js";
import { appendReductionRecord } from "../../../src/domain/reduce/persistence/adapter.js";
import type { RunRecord } from "../../../src/domain/run/model/types.js";
import { appendRunRecord } from "../../../src/domain/run/persistence/adapter.js";
import type { SpecRecord } from "../../../src/domain/spec/model/types.js";
import { appendSpecRecord } from "../../../src/domain/spec/persistence/adapter.js";
import type { VerificationRecord } from "../../../src/domain/verify/model/types.js";
import { appendVerificationRecord } from "../../../src/domain/verify/persistence/adapter.js";
import { createRunRecord } from "../../support/factories/run-records.js";

describe("executeListCommand", () => {
  let testDir: string;
  let specsFilePath: string;
  let runsFilePath: string;
  let reductionsFilePath: string;
  let verificationsFilePath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "voratiq-list-test-"));
    specsFilePath = join(testDir, ".voratiq", "spec", "index.json");
    runsFilePath = join(testDir, ".voratiq", "run", "index.json");
    reductionsFilePath = join(testDir, ".voratiq", "reduce", "index.json");
    verificationsFilePath = join(testDir, ".voratiq", "verify", "index.json");
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
    expect(result.output).toContain("SPEC");
    expect(result.output).toContain("STATUS");
    expect(result.output).toContain("CREATED");
    expect(result.output).toContain("run-visible");
    expect(result.output).not.toContain("run-pruned");
    expect(result.output).not.toContain("run-aborted");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "table",
      records: [{ id: "run-visible", specPath: "specs/task.md" }],
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
      mode: "table",
      records: [
        { id: "run-aborted" },
        { id: "run-pruned" },
        { id: "run-visible" },
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
      mode: "table",
      records: [{ id: "run-visible-newest" }],
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
    expect(result.output).not.toContain("Base Revision");
    expect(result.output).not.toContain("\nSpec");
    expect(result.json).toMatchObject({
      operator: "run",
      mode: "detail",
      sessionId: "run-pruned",
      session: {
        id: "run-pruned",
        rows: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "succeeded",
          }),
        ],
        artifacts: [],
      },
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
      mode: "table",
    });
    expect(verboseResult.json.mode).toBe("table");
    if (verboseResult.json.mode !== "table") {
      throw new Error("Expected table-mode JSON output");
    }
    expect(verboseResult.json.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "spec-visible",
          description: "Generate task spec",
        }),
        expect.objectContaining({
          id: "spec-aborted",
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
      mode: "table",
    });
    if (result.json.mode !== "table") {
      throw new Error("Expected table-mode JSON output");
    }
    expect(result.json.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "spec-running",
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
      sessionId: "spec-aborted",
      session: {
        id: "spec-aborted",
        rows: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "failed",
          }),
        ],
        artifacts: [
          expect.objectContaining({
            kind: "spec",
            agentId: "agent-a",
            path: null,
          }),
        ],
      },
    });
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
      mode: "table",
    });
    if (result.json.mode !== "table") {
      throw new Error("Expected table-mode JSON output");
    }
    expect(result.json.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "spec-messy",
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
      sessionId: "spec-detail-json",
      session: {
        id: "spec-detail-json",
        rows: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "succeeded",
          }),
        ],
        artifacts: [
          expect.objectContaining({
            kind: "spec",
            path: ".voratiq/spec/sessions/spec-detail-json/agent-a/artifacts/spec.md",
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
    expect(result.output).toContain("Agent: agent-a");
    expect(result.output).toContain("Output:");
    expect(result.output).not.toContain("\nRun");
    expect(result.json).toMatchObject({
      operator: "reduce",
      mode: "detail",
      sessionId: "reduce-detail",
      session: {
        id: "reduce-detail",
        rows: [
          expect.objectContaining({
            agentId: "agent-a",
            status: "succeeded",
          }),
        ],
        artifacts: [
          expect.objectContaining({
            kind: "reduction",
            path: ".voratiq/reduce/sessions/reduce-detail/agent-a/reduction.md",
          }),
        ],
      },
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
    expect(result.output).toContain("Output:");
    expect(result.output).not.toContain("\nRun");
    expect(result.json).toMatchObject({
      operator: "verify",
      mode: "detail",
      sessionId: "verify-detail",
      session: {
        id: "verify-detail",
        rows: [
          expect.objectContaining({
            agentId: null,
            verifier: "programmatic",
            status: "succeeded",
          }),
        ],
        artifacts: [
          expect.objectContaining({
            kind: "result",
            verifier: "programmatic",
            path: ".voratiq/verify/sessions/verify-detail/programmatic/artifacts/result.json",
          }),
        ],
      },
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
      sessionId: "spec-missing",
      session: null,
    });
  });

  function buildInput(params: {
    operator: "spec" | "run" | "reduce" | "verify";
    sessionId?: string;
    limit?: number;
    verbose?: boolean;
  }) {
    return {
      root: testDir,
      specsFilePath,
      runsFilePath,
      reductionsFilePath,
      verificationsFilePath,
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
      },
    ],
    deletedAt: params.deletedAt ?? null,
  });
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
