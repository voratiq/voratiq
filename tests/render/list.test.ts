import { renderRunList } from "../../src/render/transcripts/list.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import { createRunRecord } from "../support/factories/run-records.js";

describe("renderRunList", () => {
  it("renders a table with RUN, STATUS, SPEC, CREATED columns", () => {
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
    expect(lines[1]).toContain("2025-10-16");
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

  it("orders columns as RUN, STATUS, SPEC, CREATED", () => {
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

    expect(runIndex).toBeLessThan(statusIndex);
    expect(statusIndex).toBeLessThan(specIndex);
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
    const statusIndex = headerLine.indexOf("STATUS");
    const specIndex = headerLine.indexOf("SPEC");

    expect(firstRow.charAt(specIndex)).not.toBe(" ");
    expect(secondRow.charAt(specIndex)).not.toBe(" ");

    expect(firstRow.charAt(runIndex)).toBe("2");
    expect(secondRow.charAt(runIndex)).toBe("2");
    expect(firstRow.slice(statusIndex, specIndex).trim()).toBe("SUCCEEDED");
    expect(secondRow.slice(statusIndex, specIndex).trim()).toBe("SUCCEEDED");
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
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("SPEC");
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
