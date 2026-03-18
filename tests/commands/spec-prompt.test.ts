import { buildSpecPrompt } from "../../src/domains/specs/competition/prompt.js";

describe("buildSpecPrompt", () => {
  it("includes task framing, spec structure, and authoring guidance", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      markdownOutputPath: "spec.md",
      dataOutputPath: "spec.json",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    // Task framing
    expect(prompt).toContain("Write a spec for the task described below.");
    expect(prompt).toContain(
      "A spec defines **what** to build and **why**, not **how**.",
    );

    // Required spec structure
    expect(prompt).toContain("Required spec structure:");
    expect(prompt).toContain("## Objective");
    expect(prompt).toContain("## Scope");
    expect(prompt).toContain("## Acceptance Criteria");
    expect(prompt).toContain("## Constraints");
    expect(prompt).toContain("## Exit Signal");

    // Authoring guidance — runtime leak prevention
    expect(prompt).toContain(
      "Do not embed runtime or execution environment details",
    );
  });

  it("includes runtime constraints from shared helpers", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      markdownOutputPath: "spec.md",
      dataOutputPath: "spec.json",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

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

  it("includes output requirements with unified artifact instructions", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      markdownOutputPath: "spec.md",
      dataOutputPath: "spec.json",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    expect(prompt).toContain("Save the spec as markdown to `spec.md`");
    expect(prompt).toContain("Save the same spec as JSON to `spec.json`");
    expect(prompt).toContain("objective: string");
    expect(prompt).toContain("scope: string[]");
    expect(prompt).toContain("constraints: string[]");
    expect(prompt).toContain("exitSignal: string");
    expect(prompt).toContain("Both files must describe the same spec.");
  });

  it("includes an explicit title when provided", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      title: "Onboarding Improvements",
      markdownOutputPath: "spec.md",
      dataOutputPath: "spec.json",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    expect(prompt).toContain("Title: Onboarding Improvements");
  });

  it("places user description before constraints", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      markdownOutputPath: "spec.md",
      dataOutputPath: "spec.json",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
    });

    const descriptionIndex = prompt.indexOf("User description:");
    const constraintsIndex = prompt.indexOf("Constraints:");
    expect(descriptionIndex).toBeLessThan(constraintsIndex);
  });

  it("lists staged extra-context files when provided", () => {
    const prompt = buildSpecPrompt({
      description: "Define the onboarding flow.",
      markdownOutputPath: "spec.md",
      dataOutputPath: "spec.json",
      repoRootPath: "/repo",
      workspacePath: "/repo/.voratiq/specs/sessions/123/workspace",
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
