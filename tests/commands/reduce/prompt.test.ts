import { describe, expect, it } from "@jest/globals";

import { buildReducePrompt } from "../../../src/domains/reductions/competition/prompt.js";

describe("buildReducePrompt", () => {
  it("lists staged extra-context files when provided", () => {
    const prompt = buildReducePrompt({
      targetOperator: "run",
      targetId: "run-1",
      artifactInfoPath: "artifact-information.json",
      repoRootPath:
        "/repo/.voratiq/reductions/sessions/reduce-1/alpha/workspace",
      workspacePath:
        "/repo/.voratiq/reductions/sessions/reduce-1/alpha/workspace",
      extraContextFiles: [
        {
          absolutePath: "/repo/notes/a.md",
          displayPath: "notes/a.md",
          stagedRelativePath: "../context/a.md",
        },
      ],
    });

    expect(prompt).toContain(
      "Extra context files (staged alongside the workspace):",
    );
    expect(prompt).toContain("`../context/a.md` (source: `notes/a.md`)");
  });
});
