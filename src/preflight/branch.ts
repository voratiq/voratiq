import { getGitStderr, runGitCommand } from "../utils/git.js";
import { BranchCheckoutError } from "./errors.js";

/**
 * Checks out an existing branch or creates a new one from HEAD.
 *
 * - If the branch exists, switches to it (`git checkout`)
 * - If the branch does not exist, creates it from HEAD (`git checkout -b`)
 *
 * @throws {BranchCheckoutError} If git checkout or branch creation fails
 */
export async function checkoutOrCreateBranch(
  root: string,
  branchName: string,
): Promise<void> {
  const branchExists = await doesBranchExist(root, branchName);

  if (branchExists) {
    await checkoutBranch(root, branchName);
  } else {
    await createAndCheckoutBranch(root, branchName);
  }
}

async function doesBranchExist(
  root: string,
  branchName: string,
): Promise<boolean> {
  try {
    await runGitCommand(["rev-parse", "--verify", `refs/heads/${branchName}`], {
      cwd: root,
    });
    return true;
  } catch {
    return false;
  }
}

async function checkoutBranch(root: string, branchName: string): Promise<void> {
  try {
    await runGitCommand(["checkout", branchName], { cwd: root });
  } catch (error) {
    const stderr = getGitStderr(error);
    throw new BranchCheckoutError(
      `Failed to checkout branch '${branchName}'`,
      stderr,
    );
  }
}

async function createAndCheckoutBranch(
  root: string,
  branchName: string,
): Promise<void> {
  try {
    await runGitCommand(["checkout", "-b", branchName], { cwd: root });
  } catch (error) {
    const stderr = getGitStderr(error);
    throw new BranchCheckoutError(
      `Failed to create branch '${branchName}'`,
      stderr,
    );
  }
}
