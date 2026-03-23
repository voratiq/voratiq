import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  appendVerificationRecord,
  flushAllVerificationRecordBuffers,
  readVerificationRecords,
} from "../../src/domains/verifications/persistence/adapter.js";

describe("verification persistence", () => {
  let root: string;
  let verificationsFilePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "voratiq-verifications-"));
    verificationsFilePath = join(
      root,
      ".voratiq",
      "verifications",
      "index.json",
    );
    await mkdir(join(root, ".voratiq", "verifications"), { recursive: true });
    await mkdir(join(root, ".voratiq", "verifications", "sessions"), {
      recursive: true,
    });
    await createIndexFile(verificationsFilePath);
  });

  afterEach(async () => {
    await flushAllVerificationRecordBuffers();
    await rm(root, { recursive: true, force: true });
  });

  it("persists thin records and writes target metadata into index.json", async () => {
    const record = {
      sessionId: "verify-20260319-abc123",
      createdAt: "2026-03-19T20:00:00.000Z",
      startedAt: "2026-03-19T20:00:01.000Z",
      completedAt: "2026-03-19T20:00:05.000Z",
      status: "succeeded" as const,
      target: {
        kind: "run" as const,
        sessionId: "run-20260319-xyz789",
        candidateIds: ["agent-a", "agent-b"],
      },
      methods: [
        {
          method: "programmatic" as const,
          slug: "programmatic",
          scope: { kind: "run" as const },
          status: "succeeded" as const,
          artifactPath:
            ".voratiq/verifications/sessions/verify-20260319-abc123/programmatic/artifacts/result.json",
          startedAt: "2026-03-19T20:00:01.000Z",
          completedAt: "2026-03-19T20:00:03.000Z",
        },
        {
          method: "rubric" as const,
          template: "run-review",
          verifierId: "reviewer-a",
          scope: { kind: "run" as const },
          status: "succeeded" as const,
          artifactPath:
            ".voratiq/verifications/sessions/verify-20260319-abc123/reviewer-a/run-review/artifacts/result.json",
          startedAt: "2026-03-19T20:00:03.000Z",
          completedAt: "2026-03-19T20:00:05.000Z",
        },
      ],
    };

    await appendVerificationRecord({
      root,
      verificationsFilePath,
      record,
    });
    await flushAllVerificationRecordBuffers();

    const records = await readVerificationRecords({
      root,
      verificationsFilePath,
      limit: 1,
    });
    expect(records).toEqual([record]);

    const rawIndex = await readFile(verificationsFilePath, "utf8");
    expect(JSON.parse(rawIndex)).toEqual({
      version: 1,
      sessions: [
        {
          sessionId: "verify-20260319-abc123",
          createdAt: "2026-03-19T20:00:00.000Z",
          status: "succeeded",
          targetKind: "run",
          targetSessionId: "run-20260319-xyz789",
        },
      ],
    });

    const rawRecord = await readFile(
      join(
        root,
        ".voratiq",
        "verifications",
        "sessions",
        "verify-20260319-abc123",
        "record.json",
      ),
      "utf8",
    );
    expect(JSON.parse(rawRecord)).toEqual(record);
  });
});

async function createIndexFile(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '{\n  "version": 1,\n  "sessions": []\n}\n', "utf8");
  return path;
}
