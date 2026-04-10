import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { initializeRunRecord } from "../../../src/commands/run/record-init.js";
import { readRunRecords } from "../../../src/domain/run/persistence/adapter.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

describe("initializeRunRecord", () => {
  it("persists staged extra-context paths as the canonical run contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-record-init-"));
    try {
      await createWorkspace(root);

      const runRoot = join(root, ".voratiq", "runs", "sessions", "run-123");
      await mkdir(runRoot, { recursive: true });

      await initializeRunRecord({
        root,
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        runId: "run-123",
        specDisplayPath: "spec.md",
        baseRevisionSha: "abc123",
        repoDisplayPath: ".",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        runRoot,
        extraContext: ["../context/carry-forward.md"],
        extraContextMetadata: [
          {
            stagedPath: "../context/carry-forward.md",
            sourcePath: "/tmp/carry-forward.md",
          },
        ],
      });

      await expect(
        readRunRecords({
          root,
          runsFilePath: join(root, ".voratiq", "runs", "index.json"),
          predicate: (record) => record.runId === "run-123",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          runId: "run-123",
          extraContext: ["../context/carry-forward.md"],
          extraContextMetadata: [
            {
              stagedPath: "../context/carry-forward.md",
              sourcePath: "/tmp/carry-forward.md",
            },
          ],
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists structured spec provenance when provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-record-init-"));
    try {
      await createWorkspace(root);

      const runRoot = join(root, ".voratiq", "runs", "sessions", "run-456");
      await mkdir(runRoot, { recursive: true });

      await initializeRunRecord({
        root,
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        runId: "run-456",
        specDisplayPath:
          ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
        specTarget: {
          kind: "spec",
          sessionId: "spec-123",
          provenance: {
            lineage: "derived_modified",
            source: {
              kind: "spec",
              sessionId: "spec-123",
              agentId: "agent-a",
              outputPath: ".voratiq/spec/sessions/spec-123/agent-a/spec.md",
              contentHash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            currentContentHash:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        },
        baseRevisionSha: "def456",
        repoDisplayPath: ".",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        runRoot,
      });

      await expect(
        readRunRecords({
          root,
          runsFilePath: join(root, ".voratiq", "runs", "index.json"),
          predicate: (record) => record.runId === "run-456",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          runId: "run-456",
          spec: {
            path: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
            target: {
              kind: "spec",
              sessionId: "spec-123",
              provenance: {
                lineage: "derived_modified",
                source: {
                  kind: "spec",
                  sessionId: "spec-123",
                  agentId: "agent-a",
                  outputPath: ".voratiq/spec/sessions/spec-123/agent-a/spec.md",
                  contentHash:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                },
                currentContentHash:
                  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              },
            },
          },
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
