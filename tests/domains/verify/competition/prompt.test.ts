import { describe, expect, it } from "@jest/globals";

import { buildRubricPrompt } from "../../../../src/domain/verify/competition/prompt.js";

describe("buildRubricPrompt", () => {
  it("includes sandbox/headless constraints for verifier workspaces", () => {
    const prompt = buildRubricPrompt({
      template: {
        template: "run-verification",
        prompt: "Review the candidate outputs.",
        rubric: "Rank the candidates.",
        schema: "type: object",
      },
      target: {
        kind: "run",
        sessionId: "run-123",
        candidateIds: ["agent-a"],
      },
      staged: {
        kind: "run",
        referenceRepoPath: "reference_repo",
        specPath: "inputs/spec.md",
        candidates: [
          {
            alias: "v_aaaaaaaaaa",
            diffPath: "inputs/candidates/v_aaaaaaaaaa/diff.patch",
          },
        ],
      },
      extraContextFiles: [],
    });

    expect(prompt).toContain(
      "You are sandboxed. If an operation is blocked, skip it and continue.",
    );
    expect(prompt).toContain(
      "You are running headlessly. Do not pause for user interaction.",
    );
    expect(prompt).toContain("- Read access: `/workspace`.");
    expect(prompt).toContain(
      "- Write access: `/workspace` except read-only staged paths `/workspace/context`, `/workspace/inputs`, `/workspace/reference_repo`.",
    );
  });

  it("builds message-target prompts from the staged prompt and response artifacts", () => {
    const prompt = buildRubricPrompt({
      template: {
        template: "message-verification",
        prompt: "Review the response artifacts.",
        rubric: "Rank the response candidates.",
        schema: "type: object",
      },
      target: {
        kind: "message",
        sessionId: "message-123",
      },
      staged: {
        kind: "message",
        promptPath: "inputs/prompt.md",
        candidates: [
          {
            alias: "v_aaaaaaaaaa",
            responsePath: "inputs/candidates/v_aaaaaaaaaa/response.md",
          },
        ],
      },
      extraContextFiles: [],
    });

    expect(prompt).toContain("Original message prompt: `inputs/prompt.md`");
    expect(prompt).toContain(
      "v_aaaaaaaaaa: `inputs/candidates/v_aaaaaaaaaa/response.md`",
    );
    expect(prompt).not.toContain("Base repository snapshot");
    expect(prompt).not.toContain("diff.patch");
    expect(prompt).not.toContain("Selected spec");
  });
});
