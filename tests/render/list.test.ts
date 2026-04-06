import type { MessageRecord } from "../../src/domain/message/model/types.js";
import type { RunRecord } from "../../src/domain/run/model/types.js";
import type { SpecRecord } from "../../src/domain/spec/model/types.js";
import {
  renderMessageList,
  renderRunList,
  renderSpecList,
} from "../../src/render/transcripts/list.js";
import { formatRunTimestamp } from "../../src/render/utils/records.js";
import { createRunRecord } from "../support/factories/run-records.js";

describe("renderRunList", () => {
  it("renders a table with RUN, SPEC, STATUS, CREATED columns", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    expect(lines[0]).toContain("RUN");
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("SPEC");
    expect(lines[0]).toContain("CREATED");
    expect(lines[1]).toContain("SUCCEEDED");
    expect(lines[1]).toContain("specs/onboarding-ux.md");
    expect(lines[1]).toContain("20251016-133651-woeqr");
    const expectedTimestamp = formatRunTimestamp(records[0].createdAt);
    expect(expectedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+$/);
    expect(lines[1]).toContain(expectedTimestamp);
  });

  it("renders status values for each record", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-140000-prune",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T14:00:00.000Z",
        status: "pruned",
        deletedAt: "2025-10-17T12:00:00.000Z",
      }),
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    expect(lines[0]).toContain("STATUS");
    expect(
      lines.some(
        (line) =>
          line.includes("20251016-140000-prune") && line.includes("PRUNED"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) =>
          line.includes("20251016-133651-woeqr") && line.includes("SUCCEEDED"),
      ),
    ).toBe(true);
  });

  it("orders columns as RUN, SPEC, STATUS, CREATED", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    const output = renderRunList(records);
    const headerLine = output.split("\n")[0] ?? "";

    const runIndex = headerLine.indexOf("RUN");
    const statusIndex = headerLine.indexOf("STATUS");
    const specIndex = headerLine.indexOf("SPEC");
    const createdIndex = headerLine.indexOf("CREATED");

    expect(runIndex).toBeLessThan(specIndex);
    expect(specIndex).toBeLessThan(statusIndex);
    expect(specIndex).toBeLessThan(createdIndex);
  });

  it("displays records in the order provided", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
      buildRunRecord({
        runId: "20251016-020347-zudov",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T02:03:47.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    expect(lines[1]).toContain("20251016-133651-woeqr");
    expect(lines[2]).toContain("20251016-023258-qifyb");
    expect(lines[3]).toContain("20251016-020347-zudov");
  });

  it("aligns columns with proper padding", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/short.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    const headerLine = lines[0] ?? "";
    const firstRow = lines[1] ?? "";
    const secondRow = lines[2] ?? "";

    const runIndex = headerLine.indexOf("RUN");
    const specIndex = headerLine.indexOf("SPEC");
    const statusIndex = headerLine.indexOf("STATUS");

    expect(firstRow.charAt(specIndex)).not.toBe(" ");
    expect(secondRow.charAt(specIndex)).not.toBe(" ");

    expect(firstRow.charAt(runIndex)).toBe("2");
    expect(secondRow.charAt(runIndex)).toBe("2");
    expect(firstRow.slice(specIndex, statusIndex)).toContain("specs/");
    expect(secondRow.slice(specIndex, statusIndex)).toContain("specs/");
    expect(firstRow.slice(statusIndex).trim()).toContain("SUCCEEDED");
    expect(secondRow.slice(statusIndex).trim()).toContain("SUCCEEDED");
  });

  it("renders single record", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("RUN");
    expect(lines[0]).toContain("SPEC");
    expect(lines[0]).toContain("STATUS");
    expect(lines[1]).toContain("specs/onboarding-ux.md");
  });

  it("renders multiple records with varying lengths", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "s.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/very-long-spec-name.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("RUN");
    expect(lines[0]).toContain("SPEC");
    expect(lines[1]).toContain("20251016-133651-woeqr");
    expect(lines[2]).toContain("20251016-023258-qifyb");
  });

  it("keeps long SPEC values on a single line for narrow TTY widths", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20260328-210627-veijo",
        specPath:
          ".voratiq/spec/sessions/20260327-043019-uatir/gpt-5-4-high/artifacts/clean-up-stale-review-terminology-in-auto-verify-test-surface.md",
        createdAt: "2026-03-28T21:06:27.000Z",
      }),
    ];

    const output = renderRunList(records);
    const lines = output.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("20260328-210627-veijo");
    expect(lines[1]).toContain("SUCCEEDED");
    expect(lines[1]).toContain(".voratiq/spec/sessions/");
    expect(lines[1]).toContain("clean-up-stale");
  });
});

describe("renderSpecList", () => {
  it("truncates long descriptions to a 32-character preview", () => {
    const records: SpecRecord[] = [
      buildSpecRecord({
        sessionId: "20260331-193636-uixyb",
        status: "running",
        description:
          "Generalize voratiq list from a run-only command into an operator-shaped read command.",
      }),
    ];

    const output = renderSpecList(records);
    const lines = output.split("\n");

    expect(lines[0]).toContain("DESCRIPTION");
    expect(lines[1]).toContain("Generalize voratiq list from...");
    expect(lines[1]).not.toContain(
      "Generalize voratiq list from a run-only command into an operator-shaped read command.",
    );
  });

  it("normalizes whitespace before truncating descriptions", () => {
    const records: SpecRecord[] = [
      buildSpecRecord({
        sessionId: "20260331-192546-vitwq",
        status: "failed",
        description:
          "Generalize \nNo runs recorded. from a run-only command into an operator-shaped read command.",
      }),
    ];

    const output = renderSpecList(records);
    const lines = output.split("\n");

    expect(lines[1]).toContain("Generalize No runs recorded...");
    expect(lines[1]).not.toContain("\n");
  });
});

describe("renderMessageList", () => {
  it("renders a table with MESSAGE, PROMPT, STATUS, CREATED columns", () => {
    const records: MessageRecord[] = [
      buildMessageRecord({
        sessionId: "20260406-031050-itblf",
        status: "running",
      }),
    ];

    const output = renderMessageList(records);
    const lines = output.split("\n");

    expect(lines[0]).toContain("MESSAGE");
    expect(lines[0]).toContain("PROMPT");
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("CREATED");
    expect(lines[0]).not.toContain("RECIPIENTS");
    expect(lines[1]).toContain("20260406-031050-itblf");
    expect(lines[1]).toContain("Review this change.");
    expect(lines[1]).toContain("RUNNING");
  });

  it("orders columns as MESSAGE, PROMPT, STATUS, CREATED", () => {
    const records: MessageRecord[] = [
      buildMessageRecord({
        sessionId: "20260406-031050-itblf",
        status: "running",
      }),
    ];

    const output = renderMessageList(records);
    const headerLine = output.split("\n")[0] ?? "";

    const messageIndex = headerLine.indexOf("MESSAGE");
    const promptIndex = headerLine.indexOf("PROMPT");
    const statusIndex = headerLine.indexOf("STATUS");
    const createdIndex = headerLine.indexOf("CREATED");

    expect(messageIndex).toBeLessThan(promptIndex);
    expect(promptIndex).toBeLessThan(statusIndex);
    expect(statusIndex).toBeLessThan(createdIndex);
  });

  it("truncates long prompts to a 32-character preview", () => {
    const records: MessageRecord[] = [
      {
        ...buildMessageRecord({
          sessionId: "20260406-031050-itblf",
          status: "running",
        }),
        prompt:
          "Ask how commit 013bdf0 aligns with the existing codebase architecture and patterns.",
      },
    ];

    const output = renderMessageList(records);
    const lines = output.split("\n");

    expect(lines[1]).toContain("Ask how commit 013bdf0 aligns...");
    expect(lines[1]).not.toContain(
      "Ask how commit 013bdf0 aligns with the existing codebase architecture and patterns.",
    );
  });
});

function buildRunRecord(params: {
  runId: string;
  specPath: string;
  createdAt: string;
  status?: RunRecord["status"];
  deletedAt?: string | null;
}): RunRecord {
  return createRunRecord({
    runId: params.runId,
    baseRevisionSha: "abc123",
    spec: { path: params.specPath },
    status: params.status ?? "succeeded",
    createdAt: params.createdAt,
    agents: [],
    deletedAt: params.deletedAt ?? null,
  });
}

function buildSpecRecord(params: {
  sessionId: string;
  status: SpecRecord["status"];
  description: string;
}): SpecRecord {
  const createdAt = "2026-03-01T00:00:00.000Z";

  return {
    sessionId: params.sessionId,
    createdAt,
    startedAt: createdAt,
    status: params.status,
    description: params.description,
    agents: [],
    error: null,
  };
}

function buildMessageRecord(params: {
  sessionId: string;
  status: MessageRecord["status"];
}): MessageRecord {
  const createdAt = "2026-03-01T00:00:00.000Z";
  const completedAt =
    params.status === "running" ? undefined : "2026-03-01T00:05:00.000Z";

  return {
    sessionId: params.sessionId,
    createdAt,
    startedAt: createdAt,
    ...(completedAt ? { completedAt } : {}),
    status: params.status,
    prompt: "Review this change.",
    recipients: [
      {
        agentId: "agent-a",
        status: params.status === "running" ? "running" : "succeeded",
        startedAt: createdAt,
        ...(completedAt ? { completedAt } : {}),
        ...(params.status === "running"
          ? {}
          : {
              outputPath: `.voratiq/message/sessions/${params.sessionId}/agent-a/artifacts/response.md`,
            }),
        error: null,
      },
    ],
    error: null,
  };
}
