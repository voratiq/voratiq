import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { deriveBranchNameFromSpecPath } from "../../src/cli/run.js";
import { checkoutOrCreateBranch } from "../../src/preflight/branch.js";
import { BranchCheckoutError } from "../../src/preflight/errors.js";
import { gitAddAll, gitCommitAll, runGitCommand } from "../../src/utils/git.js";

describe("deriveBranchNameFromSpecPath", () => {
  it("extracts basename without extension from nested path", () => {
    expect(
      deriveBranchNameFromSpecPath("specs/separate-eval-outcomes.md"),
    ).toBe("separate-eval-outcomes");
  });

  it("extracts basename without extension from deeply nested path", () => {
    expect(deriveBranchNameFromSpecPath("specs/foo/bar.md")).toBe("bar");
  });

  it("extracts basename without extension from flat path", () => {
    expect(deriveBranchNameFromSpecPath("my-feature.md")).toBe("my-feature");
  });

  it("handles files without extension", () => {
    expect(deriveBranchNameFromSpecPath("specs/no-extension")).toBe(
      "no-extension",
    );
  });

  it("handles files with multiple dots", () => {
    expect(deriveBranchNameFromSpecPath("specs/feature.v2.md")).toBe(
      "feature.v2",
    );
  });

  it("handles hidden files (dotfiles)", () => {
    expect(deriveBranchNameFromSpecPath(".hidden")).toBe(".hidden");
  });

  it("handles hidden files with extension", () => {
    expect(deriveBranchNameFromSpecPath(".hidden.md")).toBe(".hidden");
  });

  it("handles different extensions", () => {
    expect(deriveBranchNameFromSpecPath("specs/task.txt")).toBe("task");
    expect(deriveBranchNameFromSpecPath("specs/task.yaml")).toBe("task");
  });
});

describe("checkoutOrCreateBranch", () => {
  const tempRepos: string[] = [];

  afterEach(async () => {
    while (tempRepos.length > 0) {
      const repo = tempRepos.pop();
      if (!repo) {
        continue;
      }
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("creates a new branch when it does not exist", async () => {
    const repoRoot = await initGitRepositoryWithCommit();
    tempRepos.push(repoRoot);

    const initialBranch = await getCurrentBranch(repoRoot);
    expect(initialBranch).not.toBe("new-feature-branch");

    await checkoutOrCreateBranch(repoRoot, "new-feature-branch");

    const currentBranch = await getCurrentBranch(repoRoot);
    expect(currentBranch).toBe("new-feature-branch");
  });

  it("checks out existing branch when it already exists", async () => {
    const repoRoot = await initGitRepositoryWithCommit();
    tempRepos.push(repoRoot);

    // Create a branch and switch back to the initial branch
    await runGitCommand(["checkout", "-b", "existing-branch"], {
      cwd: repoRoot,
    });
    await runGitCommand(["checkout", "-"], { cwd: repoRoot });

    const branchBefore = await getCurrentBranch(repoRoot);
    expect(branchBefore).not.toBe("existing-branch");

    await checkoutOrCreateBranch(repoRoot, "existing-branch");

    const branchAfter = await getCurrentBranch(repoRoot);
    expect(branchAfter).toBe("existing-branch");
  });

  it("throws BranchCheckoutError when checkout fails", async () => {
    const repoRoot = await initGitRepositoryWithCommit();
    tempRepos.push(repoRoot);

    // Create a tracked file and modify it without committing
    const filePath = join(repoRoot, "dirty.txt");
    await writeFile(filePath, "initial content", "utf8");
    await gitAddAll(repoRoot);
    await gitCommitAll({ cwd: repoRoot, message: "chore: add file" });

    // Create target branch
    await runGitCommand(["checkout", "-b", "target-branch"], { cwd: repoRoot });

    // Modify file on target branch
    await writeFile(filePath, "target branch content", "utf8");
    await gitAddAll(repoRoot);
    await gitCommitAll({ cwd: repoRoot, message: "chore: modify on target" });

    // Go back to initial branch
    await runGitCommand(["checkout", "-"], { cwd: repoRoot });

    // Modify the same file locally (uncommitted) to cause conflict
    await writeFile(filePath, "conflicting local change", "utf8");

    // Attempting to checkout target-branch should fail due to local changes
    await expect(
      checkoutOrCreateBranch(repoRoot, "target-branch"),
    ).rejects.toBeInstanceOf(BranchCheckoutError);
  });

  it("throws BranchCheckoutError with git error message when branch creation fails", async () => {
    const repoRoot = await initGitRepositoryWithCommit();
    tempRepos.push(repoRoot);

    // Create a branch with an invalid name (contains invalid characters)
    // Git doesn't allow branches starting with - or containing certain patterns
    let capturedError: BranchCheckoutError | undefined;
    try {
      await checkoutOrCreateBranch(repoRoot, "--invalid-branch-name");
    } catch (error) {
      if (error instanceof BranchCheckoutError) {
        capturedError = error;
      } else {
        throw error;
      }
    }

    expect(capturedError).toBeInstanceOf(BranchCheckoutError);
    expect(capturedError?.message).toContain("Failed to create branch");
  });
});

async function initGitRepositoryWithCommit(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-branch-"));
  await runGitCommand(["init"], { cwd: repoRoot });
  await writeFile(join(repoRoot, "README.md"), "# Test Repo\n", "utf8");
  await gitAddAll(repoRoot);
  await gitCommitAll({ cwd: repoRoot, message: "chore: initial commit" });
  return repoRoot;
}

async function getCurrentBranch(repoRoot: string): Promise<string> {
  return runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
  });
}
