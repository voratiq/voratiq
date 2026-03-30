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
  });
});
