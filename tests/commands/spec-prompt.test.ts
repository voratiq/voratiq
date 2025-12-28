import { buildSpecDraftPrompt } from "../../src/commands/spec/prompt.js";

describe("buildSpecDraftPrompt", () => {
  it("includes required headings, structure, and constraints", () => {
    const prompt = buildSpecDraftPrompt({
      description: "Define the onboarding flow.",
      draftOutputPath: "spec.md",
      repoRootPath: "/repo",
      workspaceRootPath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    expect(prompt).toContain("Structure (when needed):");
    expect(prompt).toContain(
      "H1 title, Summary, Context, Acceptance Criteria.",
    );
    expect(prompt).toContain(
      "Specs describe **what** and **why**, not **how**.",
    );
    expect(prompt).toContain("- Read access: `/repo`.");
    expect(prompt).toContain(
      "- Write access: `/repo/.voratiq/specs/sessions/123/workspace`.",
    );
    expect(prompt).toContain(
      "You are running headlessly. Do not pause for user interaction.",
    );
    expect(prompt).toContain(
      "You are sandboxed. If an operation is blocked, skip it and continue.",
    );
  });

  it("includes previous draft and feedback when refining", () => {
    const prompt = buildSpecDraftPrompt({
      description: "Define the onboarding flow.",
      previousDraft: "# Draft\nOld details",
      feedback: "Tighten scope",
      draftOutputPath: "spec.md",
      repoRootPath: "/repo",
      workspaceRootPath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    expect(prompt).toContain("Previous draft to refine:");
    expect(prompt).toContain("# Draft");
    expect(prompt).toContain("Tighten scope");
  });
});
