import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jest } from "@jest/globals";

import {
  loadRunSpecInput,
  resolveRunSpecTarget,
} from "../../../src/commands/run/spec-provenance.js";
import * as specPersistence from "../../../src/domain/spec/persistence/adapter.js";
import { appendSpecRecord } from "../../../src/domain/spec/persistence/adapter.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

function canonicalSpecRelativePath(
  sessionId: string,
  agentId: string,
): `.voratiq/spec/sessions/${string}/${string}/artifacts/spec.md` {
  return `.voratiq/spec/sessions/${sessionId}/${agentId}/artifacts/spec.md`;
}

function canonicalSpecDataRelativePath(
  sessionId: string,
  agentId: string,
): `.voratiq/spec/sessions/${string}/${string}/artifacts/spec.json` {
  return `.voratiq/spec/sessions/${sessionId}/${agentId}/artifacts/spec.json`;
}

function legacySpecRelativePath(
  sessionId: string,
  agentId: string,
): `.voratiq/spec/sessions/${string}/${string}/spec.md` {
  return `.voratiq/spec/sessions/${sessionId}/${agentId}/spec.md`;
}

function legacySpecDataRelativePath(
  sessionId: string,
  agentId: string,
): `.voratiq/spec/sessions/${string}/${string}/spec.json` {
  return `.voratiq/spec/sessions/${sessionId}/${agentId}/spec.json`;
}

describe("resolveRunSpecTarget", () => {
  it("returns a spec target when the run input matches a generated spec artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const body = "# Canonical spec\n";
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");
      const dataPath = canonicalSpecDataRelativePath("spec-123", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-123",
        "agent-a",
        "artifacts",
        "spec.md",
      );
      await mkdir(
        join(
          root,
          ".voratiq",
          "spec",
          "sessions",
          "spec-123",
          "agent-a",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, body, "utf8");

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
              contentHash: hashBody(body),
            },
          ],
        },
      });

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: artifactPath,
          specDisplayPath: outputPath,
        }),
      ).resolves.toMatchObject({
        kind: "spec",
        sessionId: "spec-123",
        provenance: {
          lineage: "exact",
          source: {
            sessionId: "spec-123",
            agentId: "agent-a",
            outputPath,
            contentHash: hashBody(body),
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a session target for canonical spec artifacts without a persisted source hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const body = "# Canonical spec\n";
      const outputPath = legacySpecRelativePath("spec-legacy", "agent-a");
      const dataPath = legacySpecDataRelativePath("spec-legacy", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-legacy",
        "agent-a",
        "spec.md",
      );
      await mkdir(
        join(root, ".voratiq", "spec", "sessions", "spec-legacy", "agent-a"),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, body, "utf8");

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-legacy",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
            },
          ],
        },
      });

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: artifactPath,
          specDisplayPath: outputPath,
        }),
      ).resolves.toEqual({
        kind: "spec",
        sessionId: "spec-legacy",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks in-place edits to canonical spec artifacts as derived_modified lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const canonicalBody = "# Canonical spec\n";
      const editedBody = "# Canonical spec\n\nEdited in place.\n";
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");
      const dataPath = canonicalSpecDataRelativePath("spec-123", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-123",
        "agent-a",
        "artifacts",
        "spec.md",
      );

      await mkdir(
        join(
          root,
          ".voratiq",
          "spec",
          "sessions",
          "spec-123",
          "agent-a",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, editedBody, "utf8");

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
              contentHash: hashBody(canonicalBody),
            },
          ],
        },
      });

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: artifactPath,
          specDisplayPath: outputPath,
        }),
      ).resolves.toEqual({
        kind: "spec",
        sessionId: "spec-123",
        provenance: {
          lineage: "derived_modified",
          source: {
            kind: "spec",
            sessionId: "spec-123",
            agentId: "agent-a",
            outputPath,
            contentHash: hashBody(canonicalBody),
          },
          currentContentHash: hashBody(editedBody),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves copied descendants with matching Voratiq frontmatter as derived spec lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const body = "# Derived spec\n";
      const copiedPath = join(root, ".voratiq", "spec", "copied.md");
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");
      const dataPath = canonicalSpecDataRelativePath("spec-123", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-123",
        "agent-a",
        "artifacts",
        "spec.md",
      );

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
              contentHash: hashBody(body),
            },
          ],
        },
      });

      await mkdir(
        join(
          root,
          ".voratiq",
          "spec",
          "sessions",
          "spec-123",
          "agent-a",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, body, "utf8");

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        copiedPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-123",
          "    agentId: agent-a",
          "---",
          body,
        ].join("\n"),
        "utf8",
      );

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: copiedPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toEqual({
        kind: "spec",
        sessionId: "spec-123",
        provenance: {
          lineage: "derived",
          source: {
            kind: "spec",
            sessionId: "spec-123",
            agentId: "agent-a",
            outputPath,
            contentHash: hashBody(body),
          },
          currentContentHash: hashBody(body),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks copied descendants with edited bodies as derived_modified lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const originalBody = "# Original spec\n";
      const copiedBody = "# Original spec\n\nEdited.\n";
      const copiedPath = join(root, ".voratiq", "spec", "copied.md");
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");
      const dataPath = canonicalSpecDataRelativePath("spec-123", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-123",
        "agent-a",
        "artifacts",
        "spec.md",
      );

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
              contentHash: hashBody(originalBody),
            },
          ],
        },
      });

      await mkdir(
        join(
          root,
          ".voratiq",
          "spec",
          "sessions",
          "spec-123",
          "agent-a",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, originalBody, "utf8");

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        copiedPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-123",
          "    agentId: agent-a",
          "---",
          copiedBody,
        ].join("\n"),
        "utf8",
      );

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: copiedPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toEqual({
        kind: "spec",
        sessionId: "spec-123",
        provenance: {
          lineage: "derived_modified",
          source: {
            kind: "spec",
            sessionId: "spec-123",
            agentId: "agent-a",
            outputPath,
            contentHash: hashBody(originalBody),
          },
          currentContentHash: hashBody(copiedBody),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a session target for copied descendants when the source session lacks a persisted hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const body = "# Derived spec\n";
      const copiedPath = join(root, ".voratiq", "spec", "copied.md");
      const outputPath = legacySpecRelativePath("spec-legacy", "agent-a");
      const dataPath = legacySpecDataRelativePath("spec-legacy", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-legacy",
        "agent-a",
        "spec.md",
      );

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-legacy",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
            },
          ],
        },
      });

      await mkdir(
        join(root, ".voratiq", "spec", "sessions", "spec-legacy", "agent-a"),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, body, "utf8");

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        copiedPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-legacy",
          "    agentId: agent-a",
          "---",
          body,
        ].join("\n"),
        "utf8",
      );

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: copiedPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toEqual({
        kind: "spec",
        sessionId: "spec-legacy",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats unexpected expanded source fields as malformed frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const copiedBody = "# Canonical spec\n";
      const copiedPath = join(root, ".voratiq", "spec", "copied.md");
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        copiedPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-123",
          "    agentId: agent-a",
          `    outputPath: ${outputPath}`,
          `    contentHash: ${hashBody("# Different source body\n")}`,
          "---",
          copiedBody,
        ].join("\n"),
        "utf8",
      );

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: copiedPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toEqual({
        kind: "file",
        provenance: {
          lineage: "invalid",
          issueCode: "malformed_frontmatter",
          currentContentHash: hashBody(copiedBody),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a file target for non-session spec inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specDisplayPath: "specs/manual.md",
        }),
      ).resolves.toEqual({
        kind: "file",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats malformed Voratiq frontmatter as invalid file provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const copiedPath = join(root, ".voratiq", "spec", "copied.md");
      const strippedBody = "# Manual task\n";

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        copiedPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId:",
          "---",
          strippedBody,
        ].join("\n"),
        "utf8",
      );

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: copiedPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toEqual({
        kind: "file",
        provenance: {
          lineage: "invalid",
          issueCode: "malformed_frontmatter",
          currentContentHash: hashBody(strippedBody),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks missing upstream spec artifacts as stale provenance metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const copiedPath = join(root, ".voratiq", "spec", "copied.md");
      const body = "# Manual task\n";

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        copiedPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-missing",
          "    agentId: agent-a",
          "---",
          body,
        ].join("\n"),
        "utf8",
      );

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: copiedPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toEqual({
        kind: "spec",
        sessionId: "spec-missing",
        provenance: {
          lineage: "invalid",
          issueCode: "stale_source",
          source: {
            kind: "spec",
            sessionId: "spec-missing",
            agentId: "agent-a",
          },
          currentContentHash: hashBody(body),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("strips Voratiq frontmatter from agent-visible prompt content", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const specPath = join(root, ".voratiq", "spec", "copied.md");
      const body = "# Task\n\nImplement the feature.\n";
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");
      const dataPath = canonicalSpecDataRelativePath("spec-123", "agent-a");

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
            },
          ],
        },
      });

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      await writeFile(
        specPath,
        [
          "---",
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-123",
          "    agentId: agent-a",
          "---",
          body,
        ].join("\n"),
        "utf8",
      );

      await expect(
        loadRunSpecInput({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specAbsolutePath: specPath,
          specDisplayPath: ".voratiq/spec/copied.md",
        }),
      ).resolves.toMatchObject({
        specContent: body,
        specTarget: {
          kind: "spec",
          sessionId: "spec-123",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves non-Voratiq frontmatter in agent-visible prompt content", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const body = "# Task\n\nImplement the feature.\n";
      const sourceBody = "# Canonical task\n";
      const specPath = join(root, ".voratiq", "spec", "copied.md");
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");
      const dataPath = canonicalSpecDataRelativePath("spec-123", "agent-a");
      const artifactPath = join(
        root,
        ".voratiq",
        "spec",
        "sessions",
        "spec-123",
        "agent-a",
        "artifacts",
        "spec.md",
      );

      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        record: {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          status: "succeeded",
          description: "Generate a spec",
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              outputPath,
              dataPath,
            },
          ],
        },
      });

      await mkdir(
        join(
          root,
          ".voratiq",
          "spec",
          "sessions",
          "spec-123",
          "agent-a",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(artifactPath, sourceBody, "utf8");

      await mkdir(join(root, ".voratiq", "spec"), { recursive: true });
      const expectedFrontmatter = [
        'title: "Keep this exact"',
        "# Preserve this comment",
        "purpose: Agent-facing metadata",
        "tags:",
        "  - alpha",
        "  - beta",
      ].join("\n");
      await writeFile(
        specPath,
        [
          "---",
          expectedFrontmatter,
          "voratiq:",
          "  source:",
          "    operator: spec",
          "    sessionId: spec-123",
          "    agentId: agent-a",
          "---",
          body,
        ].join("\n"),
        "utf8",
      );

      const loaded = await loadRunSpecInput({
        root,
        specsFilePath: join(root, ".voratiq", "spec", "index.json"),
        specAbsolutePath: specPath,
        specDisplayPath: ".voratiq/spec/copied.md",
      });

      expect(loaded.specContent).toContain('title: "Keep this exact"');
      expect(loaded.specTarget).toMatchObject({
        kind: "spec",
        sessionId: "spec-123",
      });
      expect(loaded.specContent).toBe(
        ["---", expectedFrontmatter, "---", body].join("\n"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a file target when spec history cannot be read", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-spec-target-"));

    try {
      await createWorkspace(root);
      const readSpecRecordsSpy = jest
        .spyOn(specPersistence, "readSpecRecords")
        .mockRejectedValue(new Error("boom"));
      const outputPath = canonicalSpecRelativePath("spec-123", "agent-a");

      await expect(
        resolveRunSpecTarget({
          root,
          specsFilePath: join(root, ".voratiq", "spec", "index.json"),
          specDisplayPath: outputPath,
        }),
      ).resolves.toEqual({
        kind: "file",
      });

      readSpecRecordsSpy.mockRestore();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function hashBody(body: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}
