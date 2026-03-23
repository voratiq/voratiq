import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import * as harness from "../../../src/agents/runtime/harness.js";
import { executeReduceCommand } from "../../../src/commands/reduce/command.js";
import { resolveReductionCompetitors } from "../../../src/commands/shared/resolve-reduction-competitors.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { executeSpecCommand } from "../../../src/commands/spec/command.js";
import { resolveExtraContextFiles } from "../../../src/competition/shared/extra-context.js";
import { appendSpecRecord } from "../../../src/domains/specs/persistence/adapter.js";
import { getHeadRevision } from "../../../src/utils/git.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

jest.mock("../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock(
  "../../../src/commands/shared/resolve-reduction-competitors.js",
  () => ({
    resolveReductionCompetitors: jest.fn(),
  }),
);

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/utils/git.js", () => ({
  getHeadRevision: jest.fn(),
}));

const runSandboxedAgentMock = jest.mocked(harness.runSandboxedAgent);
const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const resolveReductionCompetitorsMock = jest.mocked(
  resolveReductionCompetitors,
);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const getHeadRevisionMock = jest.mocked(getHeadRevision);

describe("end-to-end extra-context reuse loop", () => {
  it("reduces a spec and stages the reducer's reduction.json into a later spec invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-loop-"));
    try {
      await createWorkspace(root);
      getHeadRevisionMock.mockResolvedValue("spec-base-sha");

      const seedSpecId = "spec-seed";
      const seedSpecPath = ".voratiq/specs/seed.md";
      const seedSpecDataPath = ".voratiq/specs/seed.json";
      await mkdir(join(root, ".voratiq", "specs"), { recursive: true });
      await writeFile(
        join(root, ".voratiq", "specs", "seed.md"),
        "# Seed\n",
        "utf8",
      );
      await writeFile(
        join(root, ".voratiq", "specs", "seed.json"),
        JSON.stringify(
          {
            title: "Seed",
            objective: "Carry the seed forward.",
            scope: ["Use the seed draft as the baseline."],
            acceptanceCriteria: ["Use the seed."],
            constraints: ["Preserve the seed intent."],
            exitSignal: "The seed draft is reusable downstream.",
          },
          null,
          2,
        ),
        "utf8",
      );
      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        record: {
          sessionId: seedSpecId,
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          status: "succeeded",
          baseRevisionSha: "abc123",
          description: "Seed",
          agents: [
            {
              agentId: "alpha",
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:00:01.000Z",
              outputPath: seedSpecPath,
              dataPath: seedSpecDataPath,
            },
          ],
          error: null,
        },
      });

      verifyAgentProvidersMock.mockResolvedValue([]);
      resolveReductionCompetitorsMock.mockReturnValue({
        source: "cli",
        agentIds: ["alpha"],
        competitors: [
          {
            id: "alpha",
            provider: "codex",
            model: "gpt-5",
            binary: "node",
            argv: [],
          },
        ],
      });
      resolveStageCompetitorsMock.mockReturnValue({
        source: "cli",
        agentIds: ["alpha"],
        competitors: [
          {
            id: "alpha",
            provider: "codex",
            model: "gpt-5",
            binary: "node",
            argv: [],
          },
        ],
      });

      let sawExtraContextPromptSection = false;
      let sawReductionContextReference = false;

      runSandboxedAgentMock.mockImplementation(async (input) => {
        if (input.sandboxStageId === "reduce") {
          const reductionMd = [
            "## Reduction",
            "**Sources**: spec-output",
            "**Summary**: Carry forward the key decisions.",
            "",
          ].join("\n");
          const reductionJson = JSON.stringify(
            {
              summary: "Carry forward the key decisions.",
              directives: ["Use the seed spec as baseline."],
              risks: ["Missing constraints."],
            },
            null,
            2,
          );

          await writeFile(
            join(input.paths.workspacePath, "reduction.md"),
            `${reductionMd}\n`,
            "utf8",
          );
          await writeFile(
            join(input.paths.workspacePath, "reduction.json"),
            `${reductionJson}\n`,
            "utf8",
          );

          return {
            exitCode: 0,
            sandboxSettings: {
              network: { allowedDomains: [], deniedDomains: [] },
              filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
            },
            manifestEnv: {},
          };
        }

        if (input.sandboxStageId === "spec") {
          const stagedExtraContextPath = join(
            input.paths.agentRoot,
            "context",
            "reduction.json",
          );
          const reductionPayloadRaw = await readFile(
            stagedExtraContextPath,
            "utf8",
          );
          const reductionPayload = JSON.parse(reductionPayloadRaw) as {
            directives?: string[];
          };
          const directive =
            reductionPayload.directives?.[0] ?? "missing-directive";

          sawExtraContextPromptSection = input.prompt.includes(
            "Extra context files",
          );
          sawReductionContextReference = input.prompt.includes(
            "../context/reduction.json",
          );

          await writeFile(
            join(input.paths.workspacePath, "spec.md"),
            `# Spec from reduction\n\nDirective: ${directive}\n`,
            "utf8",
          );
          await writeFile(
            join(input.paths.workspacePath, "spec.json"),
            JSON.stringify(
              {
                title: "Spec from reduction",
                objective: directive,
                scope: ["Carry the reduction directive into the next draft."],
                acceptanceCriteria: [directive],
                constraints: ["Use the reduction output as context."],
                exitSignal: "The new draft reflects the reduction directive.",
              },
              null,
              2,
            ),
            "utf8",
          );

          return {
            exitCode: 0,
            sandboxSettings: {
              network: { allowedDomains: [], deniedDomains: [] },
              filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
            },
            manifestEnv: {},
          };
        }

        throw new Error(
          `Unexpected sandbox stage: ${input.sandboxStageId ?? "unknown"}`,
        );
      });

      const reductionResult = await executeReduceCommand({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        verificationsFilePath: join(
          root,
          ".voratiq",
          "verifications",
          "index.json",
        ),
        target: { type: "spec", id: seedSpecId },
        agentIds: ["alpha"],
      });

      const reductionDataPath = reductionResult.reductions[0]?.dataPath;
      expect(reductionDataPath).toMatch(/reduction\.json$/u);
      if (!reductionDataPath) {
        throw new Error("Expected reduction.json path");
      }

      const extraContextFiles = await resolveExtraContextFiles({
        root,
        paths: [reductionDataPath],
      });

      const specResult = await executeSpecCommand({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        description: "Generate a new spec using prior reduction",
        agentIds: ["alpha"],
        extraContextFiles,
      });

      if (!specResult.agents[0]?.outputPath) {
        throw new Error("Expected generated spec artifact path");
      }
      const outputAbsolute = join(
        root,
        ...specResult.agents[0].outputPath.split("/"),
      );
      const specContent = await readFile(outputAbsolute, "utf8");
      expect(sawExtraContextPromptSection).toBe(true);
      expect(sawReductionContextReference).toBe(true);
      expect(specContent).toContain(
        "Directive: Use the seed spec as baseline.",
      );
      await expect(
        readFile(
          join(root, ...(specResult.agents[0].dataPath ?? "").split("/")),
          "utf8",
        ),
      ).resolves.toContain('"title": "Spec from reduction"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
