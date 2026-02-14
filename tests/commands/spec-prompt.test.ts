import { buildSpecPrompt } from "../../src/commands/spec/prompt.js";

describe("buildSpecPrompt", () => {
  it("includes required headings, structure, and constraints", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      outputPath: "spec.md",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
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

  it("includes an explicit title when provided", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      title: "Onboarding Improvements",
      outputPath: "spec.md",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    expect(prompt).toContain("Title to use: Onboarding Improvements");
  });
});
