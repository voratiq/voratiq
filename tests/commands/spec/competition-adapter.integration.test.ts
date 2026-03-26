import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { runSandboxedAgent } from "../../../src/agents/runtime/harness.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import {
  createSpecCompetitionAdapter,
  type SpecCompetitionCandidate,
} from "../../../src/domains/specs/competition/adapter.js";
import { extractChatUsageFromArtifact } from "../../../src/workspace/chat/usage-extractor.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

jest.mock("../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock("../../../src/workspace/chat/usage-extractor.js", () => ({
  extractChatUsageFromArtifact: jest.fn(),
}));

const runSandboxedAgentMock = jest.mocked(runSandboxedAgent);
const extractChatUsageFromArtifactMock = jest.mocked(
  extractChatUsageFromArtifact,
);

const tempRoots: string[] = [];

describe("spec competition adapter native token usage integration", () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await Promise.all(
      tempRoots
        .splice(0)
        .map(async (root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("extracts provider-native token usage and returns it in spec execution reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-usage-"));
    tempRoots.push(root);
    await createWorkspace(root);

    runSandboxedAgentMock.mockImplementation(async (input) => {
      await writeFile(
        join(input.paths.workspacePath, "spec.md"),
        "# Spec\n",
        "utf8",
      );
      await writeFile(
        join(input.paths.workspacePath, "spec.json"),
        JSON.stringify(
          {
            title: "Spec",
            objective: "Define the spec outcome.",
            scope: ["Describe the requested work."],
            acceptanceCriteria: ["Do the thing."],
            constraints: ["Stay within repo context."],
            exitSignal: "The spec is ready to execute.",
          },
          null,
          2,
        ),
        "utf8",
      );
      return {
        exitCode: 0,
        signal: null,
        sandboxSettings: minimalSandboxSettings(),
        manifestEnv: {},
        chat: {
          captured: true,
          format: "jsonl",
          artifactPath: "/tmp/spec.chat.jsonl",
        },
      };
    });

    extractChatUsageFromArtifactMock.mockResolvedValue({
      status: "available",
      provider: "codex",
      modelId: "gpt-5",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });

    const adapter = createSpecCompetitionAdapter({
      root,
      sessionId: "spec-usage",
      description: "Generate a spec",
      environment: {},
    });

    const candidates: SpecCompetitionCandidate[] = [
      {
        id: "spec-agent",
        provider: "codex",
        model: "gpt-5",
        binary: "node",
        argv: [],
      },
    ];

    const results = await executeCompetitionWithAdapter({
      candidates,
      maxParallel: 1,
      adapter,
    });

    expect(results).toEqual([
      expect.objectContaining({
        agentId: "spec-agent",
        status: "succeeded",
        tokenUsage: {
          input_tokens: 120,
          cached_input_tokens: 30,
          output_tokens: 45,
          reasoning_output_tokens: 7,
          total_tokens: 202,
        },
        tokenUsageResult: {
          status: "available",
          provider: "codex",
          modelId: "gpt-5",
          tokenUsage: {
            input_tokens: 120,
            cached_input_tokens: 30,
            output_tokens: 45,
            reasoning_output_tokens: 7,
            total_tokens: 202,
          },
        },
      }),
    ]);
    expect(extractChatUsageFromArtifactMock).toHaveBeenCalledWith({
      artifactPath: "/tmp/spec.chat.jsonl",
      format: "jsonl",
      providerId: "codex",
      modelId: "gpt-5",
    });
  });

  it("keeps spec execution non-fatal when token usage extraction fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-usage-"));
    tempRoots.push(root);
    await createWorkspace(root);

    runSandboxedAgentMock.mockImplementation(async (input) => {
      await writeFile(
        join(input.paths.workspacePath, "spec.md"),
        "# Spec\n",
        "utf8",
      );
      await writeFile(
        join(input.paths.workspacePath, "spec.json"),
        JSON.stringify(
          {
            title: "Spec",
            objective: "Define the spec outcome.",
            scope: ["Describe the requested work."],
            acceptanceCriteria: ["Do the thing."],
            constraints: ["Stay within repo context."],
            exitSignal: "The spec is ready to execute.",
          },
          null,
          2,
        ),
        "utf8",
      );
      return {
        exitCode: 0,
        signal: null,
        sandboxSettings: minimalSandboxSettings(),
        manifestEnv: {},
        chat: {
          captured: true,
          format: "jsonl",
          artifactPath: "/tmp/spec.chat.jsonl",
        },
      };
    });

    extractChatUsageFromArtifactMock.mockResolvedValue({
      status: "unavailable",
      reason: "extractor_error",
      provider: "codex",
      modelId: "gpt-5",
      message: "Chat usage extraction failed: boom",
    });

    const adapter = createSpecCompetitionAdapter({
      root,
      sessionId: "spec-usage",
      description: "Generate a spec",
      environment: {},
    });

    const candidates: SpecCompetitionCandidate[] = [
      {
        id: "spec-agent",
        provider: "codex",
        model: "gpt-5",
        binary: "node",
        argv: [],
      },
    ];

    const results = await executeCompetitionWithAdapter({
      candidates,
      maxParallel: 1,
      adapter,
    });

    expect(results).toEqual([
      expect.objectContaining({
        agentId: "spec-agent",
        status: "succeeded",
        tokenUsageResult: {
          status: "unavailable",
          reason: "extractor_error",
          provider: "codex",
          modelId: "gpt-5",
          message: "Chat usage extraction failed: boom",
        },
      }),
    ]);
    expect(results[0]?.tokenUsage).toBeUndefined();
  });

  it("derives final artifact filenames from spec.json title instead of the prompt hint title", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-title-slug-"));
    tempRoots.push(root);
    await createWorkspace(root);

    runSandboxedAgentMock.mockImplementation(async (input) => {
      await writeFile(
        join(input.paths.workspacePath, "spec.md"),
        "# Prompt Hint Title\n",
        "utf8",
      );
      await writeFile(
        join(input.paths.workspacePath, "spec.json"),
        JSON.stringify(
          {
            title: "Generated Truth Title",
            objective: "Define the spec outcome.",
            scope: ["Describe the requested work."],
            acceptanceCriteria: ["Do the thing."],
            constraints: ["Stay within repo context."],
            exitSignal: "The spec is ready to execute.",
          },
          null,
          2,
        ),
        "utf8",
      );
      return {
        exitCode: 0,
        signal: null,
        sandboxSettings: minimalSandboxSettings(),
        manifestEnv: {},
      };
    });

    const adapter = createSpecCompetitionAdapter({
      root,
      sessionId: "spec-title-slug",
      description: "Generate a spec",
      specTitle: "Prompt Hint Title",
      environment: {},
    });

    const candidates: SpecCompetitionCandidate[] = [
      {
        id: "spec-agent",
        provider: "codex",
        model: "gpt-5",
        binary: "node",
        argv: [],
      },
    ];

    const results = await executeCompetitionWithAdapter({
      candidates,
      maxParallel: 1,
      adapter,
    });

    expect(results).toEqual([
      expect.objectContaining({
        agentId: "spec-agent",
        status: "succeeded",
        outputPath:
          ".voratiq/specs/sessions/spec-title-slug/spec-agent/artifacts/generated-truth-title.md",
        dataPath:
          ".voratiq/specs/sessions/spec-title-slug/spec-agent/artifacts/generated-truth-title.json",
      }),
    ]);
  });
});

function minimalSandboxSettings(): {
  network: { allowedDomains: string[]; deniedDomains: string[] };
  filesystem: { denyRead: string[]; allowWrite: string[]; denyWrite: string[] };
} {
  return {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
  };
}
