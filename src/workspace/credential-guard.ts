import { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { AgentProcessError } from "../commands/run/errors.js";

const FORBIDDEN_SEGMENTS = new Set([".gemini", ".codex", ".claude"]);

export async function enforceCredentialExclusion(options: {
  workspacePath: string;
  diffContent: string;
}): Promise<void> {
  const { workspacePath, diffContent } = options;
  const detected = new Set<string>();

  const leakedFromDiff = findForbiddenPathsInDiff(diffContent);
  leakedFromDiff.forEach((path) => detected.add(path));

  const leakedOnDisk = await findForbiddenOnDisk(workspacePath);
  leakedOnDisk.forEach((path) => detected.add(path));

  if (detected.size > 0) {
    const paths = Array.from(detected).sort();
    const detail =
      "Credential files must stay inside the sandbox and are not allowed in the workspace.";
    throw new AgentProcessError({
      detail: `${detail} Found: ${paths.join(", ")}`,
    });
  }
}

function findForbiddenPathsInDiff(diffContent: string): string[] {
  const matches: string[] = [];
  const lines = diffContent.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git a/")) {
      const parts = line.split(" ");
      const aPath = parts[2]?.replace(/^a\//, "");
      const bPath = parts[3]?.replace(/^b\//, "");
      [aPath, bPath].forEach((path) => {
        if (path && containsForbiddenSegment(path)) {
          matches.push(path);
        }
      });
      continue;
    }
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const path = line.slice(6);
      if (containsForbiddenSegment(path)) {
        matches.push(path);
      }
    }
  }
  return matches;
}

async function findForbiddenOnDisk(root: string): Promise<string[]> {
  const found: string[] = [];
  await walk(root, (current, entry) => {
    if (containsForbiddenSegment(entry.name)) {
      found.push(relative(root, join(current, entry.name)) || entry.name);
      return false;
    }
    return true;
  });
  return found;
}

async function walk(
  directory: string,
  onEntry: (currentPath: string, entry: Dirent) => Promise<boolean> | boolean,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const shouldDescend = await onEntry(directory, entry);
    if (!shouldDescend) {
      continue;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walk(join(directory, entry.name), onEntry);
    }
  }
}

function containsForbiddenSegment(pathname: string): boolean {
  return pathname.split(/[\\/]/).some((segment) => {
    return segment === "" ? false : FORBIDDEN_SEGMENTS.has(segment);
  });
}
