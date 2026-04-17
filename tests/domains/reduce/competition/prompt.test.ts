import { describe, expect, it } from "@jest/globals";

import { buildReducePrompt } from "../../../../src/domain/reduce/competition/prompt.js";

describe("buildReducePrompt", () => {
  it("includes markdown and reduction artifact requirements", () => {
    const prompt = buildReducePrompt({
      targetOperator: "run",
      targetId: "run-1",
      artifactInfoPath: "artifact-information.json",
      workspacePath: "/repo/.voratiq/reduce/sessions/reduce-1/alpha/workspace",
    });

    expect(prompt).toContain(
      "Save the full reduction to `reduction.md` in the workspace root.",
    );
    expect(prompt).toContain(
      "Save the machine-readable reduction to `reduction.json` in the workspace root, with this shape:",
    );
    expect(prompt).toContain(
      '{"summary":"<summary>","directives":["<directive>"],"risks":["<risk>"]}',
    );
    expect(prompt).toContain(
      "The machine-readable reduction must match the same synthesis described in `## Synthesis`.",
    );
  });

  it("lists staged extra-context files when provided", () => {
    const prompt = buildReducePrompt({
      targetOperator: "run",
      targetId: "run-1",
      artifactInfoPath: "artifact-information.json",
      workspacePath: "/repo/.voratiq/reduce/sessions/reduce-1/alpha/workspace",
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
