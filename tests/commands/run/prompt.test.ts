import { describe, expect, it } from "@jest/globals";

import { buildRunPrompt } from "../../../src/commands/run/prompt.js";

describe("buildRunPrompt", () => {
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
