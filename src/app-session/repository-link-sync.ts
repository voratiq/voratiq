import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";

import { runGitCommand } from "../utils/git.js";
import { sanitizeSlug } from "../utils/slug.js";
import type { AppRepositoryConnectionEnsureRequest } from "./repository-connections.js";

type ResolveRealpath = (path: string) => Promise<string>;
type RunGitRepositoryCommand = (
  args: string[],
  options: { cwd: string },
) => Promise<string>;

interface RepositoryConnectionEnsureRequestDependencies {
  realpathImpl: ResolveRealpath;
  runGitCommand: RunGitRepositoryCommand;
}

export async function buildRepositoryConnectionEnsureRequest(
  repoRoot: string,
  dependencies: Partial<RepositoryConnectionEnsureRequestDependencies> = {},
): Promise<AppRepositoryConnectionEnsureRequest> {
  const deps: RepositoryConnectionEnsureRequestDependencies = {
    realpathImpl: realpath,
    runGitCommand,
    ...dependencies,
  };

  const resolvedRepoRoot = await resolveRepoRootRealPath(
    repoRoot,
    deps.realpathImpl,
  );
  const gitRootBasename = basename(repoRoot);
  const gitOriginUrl = await readGitOriginUrl(repoRoot, deps.runGitCommand);
  const localRepoKey = `repo:${hashBareValue(resolvedRepoRoot)}`;
  const slug = sanitizeSlug(gitRootBasename) || "repository";

  return {
    local_repo_key: localRepoKey,
    slug,
    display_name: gitRootBasename || undefined,
    git_remote_fingerprint: gitOriginUrl
      ? hashFingerprint(gitOriginUrl)
      : undefined,
    git_origin_url: gitOriginUrl ?? undefined,
  };
}

async function resolveRepoRootRealPath(
  repoRoot: string,
  realpathImpl: ResolveRealpath,
): Promise<string> {
  try {
    return await realpathImpl(repoRoot);
  } catch {
    return repoRoot;
  }
}

async function readGitOriginUrl(
  repoRoot: string,
  runGitCommandImpl: RunGitRepositoryCommand,
): Promise<string | undefined> {
  try {
    const origin = await runGitCommandImpl(["remote", "get-url", "origin"], {
      cwd: repoRoot,
    });
    return origin || undefined;
  } catch {
    return undefined;
  }
}

function hashFingerprint(value: string): `sha256:${string}` {
  return `sha256:${hashBareValue(value)}`;
}

function hashBareValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
