import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { pathExists } from "../../../src/utils/fs.js";
import {
  preserveProviderChatTranscripts,
  snapshotProviderTranscripts,
} from "../../../src/workspace/chat/artifacts.js";

const TEMP_PREFIX = "chat-artifacts-";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("preserveProviderChatTranscripts", () => {
  it("copies Codex JSONL transcripts so they survive sandbox deletion", async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    tempRoots.push(agentRoot);

    const sandboxSessionDir = join(
      agentRoot,
      "sandbox",
      ".codex",
      "sessions",
      "2025-11-17",
    );
    await mkdir(sandboxSessionDir, { recursive: true });

    const transcriptA = join(sandboxSessionDir, "rollout-1.jsonl");
    const transcriptB = join(sandboxSessionDir, "rollout-2.jsonl");
    await writeFile(transcriptA, `${JSON.stringify({ step: 1 })}\n`, "utf8");
    await writeFile(transcriptB, `${JSON.stringify({ step: 2 })}\n`, "utf8");

    const result = await preserveProviderChatTranscripts({
      providerId: "codex",
      agentRoot,
    });

    expect(result.status).toBe("captured");
    expect(result.format).toBe("jsonl");
    expect(result.sourceCount).toBe(2);

    const artifactPath = join(agentRoot, "artifacts", "chat.jsonl");
    const contents = await readFile(artifactPath, "utf8");
    expect(contents).toContain('"step":1');
    expect(contents).toContain('"step":2');

    await rm(join(agentRoot, "sandbox"), { recursive: true, force: true });
    expect(await pathExists(artifactPath)).toBe(true);
  });

  it("bundles Gemini JSON transcripts with metadata", async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    tempRoots.push(agentRoot);

    const sandboxChatsDir = join(
      agentRoot,
      "sandbox",
      ".gemini",
      "tmp",
      "hash-123",
      "chats",
    );
    await mkdir(sandboxChatsDir, { recursive: true });

    const transcriptOne = join(sandboxChatsDir, "session-123.json");
    const transcriptTwo = join(sandboxChatsDir, "session-456.json");
    await writeFile(
      transcriptOne,
      `${JSON.stringify({ messages: 4 })}\n`,
      "utf8",
    );
    await writeFile(
      transcriptTwo,
      `${JSON.stringify({ messages: 7 })}\n`,
      "utf8",
    );

    const result = await preserveProviderChatTranscripts({
      providerId: "gemini",
      agentRoot,
    });

    expect(result.status).toBe("captured");
    expect(result.format).toBe("json");

    const artifactPath = join(agentRoot, "artifacts", "chat.json");
    const payload = JSON.parse(await readFile(artifactPath, "utf8")) as {
      provider: string;
      transcripts: Array<{ source: string; payload: unknown }>;
    };
    expect(payload.provider).toBe("gemini");
    expect(payload.transcripts).toHaveLength(2);
    expect(payload.transcripts[0]?.payload).toMatchObject({ messages: 4 });
    expect(payload.transcripts[1]?.payload).toMatchObject({ messages: 7 });

    await rm(join(agentRoot, "sandbox"), { recursive: true, force: true });
    expect(await pathExists(artifactPath)).toBe(true);
  });

  it("preserves the relative source paths for Gemini transcripts", async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    tempRoots.push(agentRoot);

    const chatsDir = join(
      agentRoot,
      "sandbox",
      ".gemini",
      "tmp",
      "hash",
      "chats",
    );
    await mkdir(chatsDir, { recursive: true });
    const transcriptA = join(chatsDir, "session-aaa.json");
    const transcriptB = join(chatsDir, "session-bbb.json");
    await writeFile(transcriptA, "{}", "utf8");
    await writeFile(transcriptB, "{}", "utf8");

    await preserveProviderChatTranscripts({
      providerId: "gemini",
      agentRoot,
    });

    const artifactPath = join(agentRoot, "artifacts", "chat.json");
    const payload = JSON.parse(await readFile(artifactPath, "utf8")) as {
      transcripts: Array<{ source: string }>;
    };
    const sources = payload.transcripts?.map((entry) => entry.source);
    expect(sources).toEqual([
      "sandbox/.gemini/tmp/hash/chats/session-aaa.json",
      "sandbox/.gemini/tmp/hash/chats/session-bbb.json",
    ]);
  });

  it("captures only new Codex transcripts from a concrete ambient provider home", async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    const homeRoot = await mkdtemp(join(tmpdir(), `${TEMP_PREFIX}home-`));
    tempRoots.push(agentRoot, homeRoot);

    const codexSessionsDir = join(homeRoot, ".codex", "sessions", "2025-11-17");
    await mkdir(codexSessionsDir, { recursive: true });

    const staleTranscript = join(codexSessionsDir, "stale.jsonl");
    await writeFile(
      staleTranscript,
      `${JSON.stringify({ step: "stale" })}\n`,
      "utf8",
    );

    const baseline = await snapshotProviderTranscripts({
      providerId: "codex",
      agentRoot,
      searchEnv: { HOME: homeRoot },
    });

    const freshTranscript = join(codexSessionsDir, "fresh.jsonl");
    await writeFile(
      freshTranscript,
      `${JSON.stringify({ step: "fresh" })}\n`,
      "utf8",
    );

    const result = await preserveProviderChatTranscripts({
      providerId: "codex",
      agentRoot,
      searchEnv: { HOME: homeRoot },
      baseline,
    });

    expect(result.status).toBe("captured");
    expect(result.format).toBe("jsonl");
    expect(result.sourceCount).toBe(1);

    const artifactPath = join(agentRoot, "artifacts", "chat.jsonl");
    const contents = await readFile(artifactPath, "utf8");
    expect(contents).toContain('"step":"fresh"');
    expect(contents).not.toContain('"step":"stale"');
  });

  it("captures only new Claude transcripts from a concrete ambient provider home", async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    const homeRoot = await mkdtemp(join(tmpdir(), `${TEMP_PREFIX}home-`));
    tempRoots.push(agentRoot, homeRoot);

    const claudeProjectsDir = join(
      homeRoot,
      ".claude",
      "projects",
      "-Users-test-repo",
    );
    await mkdir(claudeProjectsDir, { recursive: true });

    const staleTranscript = join(claudeProjectsDir, "stale.jsonl");
    await writeFile(
      staleTranscript,
      `${JSON.stringify({ step: "stale" })}\n`,
      "utf8",
    );

    const baseline = await snapshotProviderTranscripts({
      providerId: "claude",
      agentRoot,
      searchEnv: { HOME: homeRoot },
    });

    const freshTranscript = join(claudeProjectsDir, "fresh.jsonl");
    await writeFile(
      freshTranscript,
      `${JSON.stringify({ step: "fresh" })}\n`,
      "utf8",
    );

    const result = await preserveProviderChatTranscripts({
      providerId: "claude",
      agentRoot,
      searchEnv: { HOME: homeRoot },
      baseline,
    });

    expect(result.status).toBe("captured");
    expect(result.format).toBe("jsonl");
    expect(result.sourceCount).toBe(1);

    const artifactPath = join(agentRoot, "artifacts", "chat.jsonl");
    const contents = await readFile(artifactPath, "utf8");
    expect(contents).toContain('"step":"fresh"');
    expect(contents).not.toContain('"step":"stale"');
  });
});
