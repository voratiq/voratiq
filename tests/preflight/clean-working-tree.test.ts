jest.mock("../../src/utils/git.js", () => ({
  runGitCommand: jest.fn(),
  assertGitRepository: jest.fn(),
}));

import {
  buildDirtyWorkingTreeDetailLines,
  ensureCleanWorkingTree,
} from "../../src/preflight/index.js";
import type { DirtyPathSummary } from "../../src/utils/git.js";
import { runGitCommand } from "../../src/utils/git.js";

const runGitCommandMock = runGitCommand as jest.MockedFunction<
  typeof runGitCommand
>;

describe("ensureCleanWorkingTree", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    runGitCommandMock.mockReset();
  });

  it("passes when no dirty entries are reported", async () => {
    runGitCommandMock.mockResolvedValueOnce("");

    const result = await ensureCleanWorkingTree("/repo");
    expect(result).toEqual({ cleanWorkingTree: true });
  });

  it("throws DirtyWorkingTreeError with detail lines", async () => {
    runGitCommandMock.mockResolvedValueOnce(" M src/index.ts\nA  README.md\n");

    const invocation = ensureCleanWorkingTree("/repo");

    await expect(invocation).rejects.toMatchObject({
      detailLines: [
        "Dirty paths:",
        "  - src/index.ts (modified)",
        "  - README.md (staged add)",
      ],
    });
  });
});

describe("buildDirtyWorkingTreeDetailLines", () => {
  it("limits the number of entries but reports overflow", () => {
    const entries: DirtyPathSummary[] = [
      { path: "src/app.ts", annotation: "modified" },
      { path: "src/config.ts", annotation: "staged" },
      { path: "README.md", annotation: "added" },
      { path: "docs/testing.md", annotation: "modified" },
    ];

    const lines = buildDirtyWorkingTreeDetailLines(entries, "Dirty summary:");

    expect(lines).toEqual([
      "Dirty summary:",
      "  - src/app.ts (modified)",
      "  - src/config.ts (staged)",
      "  - README.md (added)",
      "  - (and 1 more path)",
    ]);
  });
});
