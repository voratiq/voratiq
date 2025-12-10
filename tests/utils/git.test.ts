import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { GitHeadRequiredError } from "../../src/utils/errors.js";
import {
  getGitStderr,
  getHeadRevision,
  GIT_AUTHOR_EMAIL,
  GIT_AUTHOR_NAME,
  gitAddAll,
  gitCommitAll,
  runGitCommand,
} from "../../src/utils/git.js";

describe("getGitStderr", () => {
  it("returns trimmed stderr output when present", () => {
    const error = { stderr: " fatal: bad revision \n" };
    expect(getGitStderr(error)).toBe("fatal: bad revision");
  });

  it("returns undefined when stderr is missing or empty", () => {
    expect(getGitStderr(new Error("boom"))).toBeUndefined();
    expect(getGitStderr({ stderr: "   " })).toBeUndefined();
  });
});

describe("gitCommitAll", () => {
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

  it("applies a provided persona to commits", async () => {
    const repoRoot = await initGitRepository();
    tempRepos.push(repoRoot);
    await writeFile(
      join(repoRoot, "persona.txt"),
      "persona-aware commit",
      "utf8",
    );
    await gitAddAll(repoRoot);

    const persona = {
      authorName: "Sandbox Persona",
      authorEmail: "persona@example.com",
    };
    await gitCommitAll({
      cwd: repoRoot,
      message: "persona commit",
      authorName: persona.authorName,
      authorEmail: persona.authorEmail,
    });

    const logLine = await runGitCommand(["log", "-1", "--pretty=%an <%ae>"], {
      cwd: repoRoot,
    });
    expect(logLine).toBe(`${persona.authorName} <${persona.authorEmail}>`);
  });

  it("falls back to the sandbox defaults when persona is omitted", async () => {
    const repoRoot = await initGitRepository();
    tempRepos.push(repoRoot);
    await writeFile(
      join(repoRoot, "default.txt"),
      "default persona commit",
      "utf8",
    );
    await gitAddAll(repoRoot);

    await gitCommitAll({
      cwd: repoRoot,
      message: "default persona commit",
    });

    const logLine = await runGitCommand(["log", "-1", "--pretty=%an <%ae>"], {
      cwd: repoRoot,
    });
    expect(logLine).toBe(`${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>`);
  });
});

describe("getHeadRevision", () => {
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

  it("throws a friendly error when the repository has no commits", async () => {
    const repoRoot = await initGitRepository();
    tempRepos.push(repoRoot);

    let captured: unknown;
    await expect(
      getHeadRevision(repoRoot).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeInstanceOf(GitHeadRequiredError);

    expect(captured).toBeInstanceOf(GitHeadRequiredError);
    const typed = captured as GitHeadRequiredError;
    expect(typed.message).toBe("Repository has no commits yet.");
    expect(typed.hintLines).toEqual(["Create an initial commit and re-run."]);
  });

  it("returns the HEAD revision once an initial commit exists", async () => {
    const repoRoot = await initGitRepository();
    tempRepos.push(repoRoot);
    await writeFile(join(repoRoot, "hello.txt"), "hi", "utf8");
    await gitAddAll(repoRoot);
    await gitCommitAll({ cwd: repoRoot, message: "chore: init" });

    const head = await getHeadRevision(repoRoot);

    expect(head).toMatch(/^[a-f0-9]{40}$/);
    const logHead = await runGitCommand(["rev-parse", "HEAD"], {
      cwd: repoRoot,
    });
    expect(logHead).toBe(head);
  });
});

async function initGitRepository(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-git-"));
  await runGitCommand(["init"], { cwd: repoRoot });
  return repoRoot;
}
