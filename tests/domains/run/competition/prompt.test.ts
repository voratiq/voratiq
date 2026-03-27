import { buildRunPrompt } from "../../../../src/domain/run/competition/prompt.js";

describe("buildRunPrompt", () => {
  it("includes spec metadata, constraints, and workspace boundary instructions", () => {
    const prompt = buildRunPrompt({
      specContent: "# Example\nDo the work.",
      workspacePath: "/repo/.voratiq/run/sessions/run-123/agent-123/workspace",
    });

    expect(prompt).toContain("Implement the following task:");
    expect(prompt).toContain("# Example\nDo the work.");
    expect(prompt).toContain(
      "- When finished, clean the workspace of temporary files/dirs you created (e.g., `tmp`, `.tmp`, etc.) unless they are intended deliverables.",
    );
    expect(prompt).toContain(
      "- Then write a 1-2 sentence summary to `.summary.txt` in the workspace root.",
    );
    expect(prompt).toContain(
      "- You are running headlessly. Do not pause for user interaction.",
    );
    expect(prompt).toContain(
      "- You are sandboxed. If an operation is blocked, skip it and continue.",
    );
    expect(prompt).toContain(
      "- Read access: `/repo/.voratiq/run/sessions/run-123/agent-123/workspace`.",
    );
    expect(prompt).toContain(
      "- Write access: `/repo/.voratiq/run/sessions/run-123/agent-123/workspace`.",
    );
    expect(prompt).toContain("Do not write files outside the workspace.");
  });

  it("lists staged extra-context files when provided", () => {
    const prompt = buildRunPrompt({
      specContent: "# Spec\n\nDo the thing.\n",
      workspacePath: "/repo/.voratiq/run/sessions/run-1/agent/workspace",
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
