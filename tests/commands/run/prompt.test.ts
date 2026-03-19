import { describe, expect, it } from "@jest/globals";

import { buildRunPrompt } from "../../../src/domains/runs/competition/prompt.js";

describe("buildRunPrompt", () => {
  it("includes cleanup and summary artifact instructions", () => {
    const prompt = buildRunPrompt({
      specContent: "# Spec\n\nDo the thing.\n",
      workspacePath: "/repo/.voratiq/runs/sessions/run-1/agent/workspace",
    });

    expect(prompt).toContain(
      "When finished, clean the workspace of temporary files/dirs you created",
    );
    expect(prompt).toContain(
      "Then write a 1-2 sentence summary to `.summary.txt` in the workspace root.",
    );
    expect(prompt).toContain("Do not write files outside the workspace.");
  });

  it("lists staged extra-context files when provided", () => {
    const prompt = buildRunPrompt({
      specContent: "# Spec\n\nDo the thing.\n",
      workspacePath: "/repo/.voratiq/runs/sessions/run-1/agent/workspace",
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
