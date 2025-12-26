import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { executeListCommand } from "../../src/commands/list/command.js";
import { appendRunRecord } from "../../src/runs/records/persistence.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import { createRunRecord } from "../support/factories/run-records.js";

describe("executeListCommand", () => {
  let testDir: string;
  let runsFilePath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "voratiq-list-test-"));
    runsFilePath = join(testDir, ".voratiq", "runs", "index.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("renders records with RUN, STATUS, SPEC, CREATED columns in order", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
    });

    expect(result.warnings).toEqual([]);
    expect(result.output).toBeDefined();
    const lines = result.output?.split("\n") ?? [];
    expect(lines[0]).toContain("RUN");
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("SPEC");
    expect(lines[0]).toContain("CREATED");
    const headerLine = lines[0] ?? "";
    const runIndex = headerLine.indexOf("RUN");
    const statusIndex = headerLine.indexOf("STATUS");
    const specIndex = headerLine.indexOf("SPEC");
    const createdIndex = headerLine.indexOf("CREATED");
    expect(runIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeGreaterThan(runIndex);
    expect(specIndex).toBeGreaterThan(statusIndex);
    expect(createdIndex).toBeGreaterThan(specIndex);
    expect(lines[1]).toContain("specs/onboarding-ux.md");
    expect(lines[1]).toContain("20251016-133651-woeqr");
    expect(lines[2]).toContain("specs/onboarding-ux.md");
    expect(lines[2]).toContain("20251016-023258-qifyb");
  });

  it("omits pruned runs by default", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
      buildRunRecord({
        runId: "20251016-140000-prune",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T14:00:00.000Z",
        status: "pruned",
        deletedAt: "2025-10-17T12:00:00.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
    });

    const output = result.output ?? "";
    expect(output).toContain("20251016-133651-woeqr");
    expect(output).not.toContain("20251016-140000-prune");
    expect(output).not.toContain("PRUNED");
  });

  it("includes pruned runs with status when includePruned is true", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
      buildRunRecord({
        runId: "20251016-140000-prune",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T14:00:00.000Z",
        status: "pruned",
        deletedAt: "2025-10-17T12:00:00.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
      includePruned: true,
    });

    const output = result.output ?? "";
    const lines = output.split("\n");
    expect(lines[0]).toContain("STATUS");
    expect(
      lines.some(
        (line) =>
          line.includes("20251016-133651-woeqr") && line.includes("SUCCEEDED"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) =>
          line.includes("20251016-140000-prune") && line.includes("PRUNED"),
      ),
    ).toBe(true);
    expect(output).toContain("20251016-133651-woeqr");
    expect(output).toContain("20251016-140000-prune");
  });

  it("filters by spec path", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-120000-aaaaa",
        specPath: "specs/other.md",
        createdAt: "2025-10-16T12:00:00.000Z",
      }),
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
      specPath: "specs/onboarding-ux.md",
    });

    expect(result.output).toContain("20251016-133651-woeqr");
    expect(result.output).not.toContain("20251016-120000-aaaaa");
  });

  it("filters by run identifier", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
      runId: "20251016-133651-woeqr",
    });

    expect(result.output).toContain("20251016-133651-woeqr");
    expect(result.output).not.toContain("20251016-023258-qifyb");
  });

  it("combines spec and run filters", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/other.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
      specPath: "specs/onboarding-ux.md",
      runId: "20251016-133651-woeqr",
    });

    expect(result.output).toContain("20251016-133651-woeqr");
    expect(result.output).not.toContain("20251016-023258-qifyb");
  });

  it("returns filtered empty message when filters yield no results", async () => {
    await writeRunsFile(testDir, runsFilePath, []);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
      specPath: "specs/does-not-exist.md",
    });

    expect(result.output).toBe("No records match the provided filters.");
  });

  it("returns undefined output when no records exist and no filters", async () => {
    await writeRunsFile(testDir, runsFilePath, []);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
    });

    expect(result.output).toBeUndefined();
  });

  it("sorts records chronologically with newest first", async () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-020347-zudov",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T02:03:47.000Z",
      }),
      buildRunRecord({
        runId: "20251016-023258-qifyb",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T02:32:58.000Z",
      }),
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    await writeRunsFile(testDir, runsFilePath, records);

    const result = await executeListCommand({
      root: testDir,
      runsFilePath,
    });

    expect(result.output).toBeDefined();
    const lines = result.output?.split("\n") ?? [];
    expect(lines[1]).toContain("20251016-133651-woeqr");
    expect(lines[2]).toContain("20251016-023258-qifyb");
    expect(lines[3]).toContain("20251016-020347-zudov");
  });
});

async function writeRunsFile(
  root: string,
  runsFilePath: string,
  records: RunRecord[],
): Promise<void> {
  const runsDir = dirname(runsFilePath);
  await rm(runsDir, { recursive: true, force: true });
  await mkdir(runsDir, { recursive: true });

  if (records.length === 0) {
    const emptyIndex = JSON.stringify({ version: 2, sessions: [] }, null, 2);
    await writeFile(runsFilePath, `${emptyIndex}\n`, "utf8");
    return;
  }

  for (const record of records) {
    await appendRunRecord({ root, runsFilePath, record });
  }
}

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
