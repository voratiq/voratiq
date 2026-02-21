export interface ComposeReviewSandboxPolicyInput {
  runWorkspaceAbsolute: string;
  stageWriteProtectedPaths: readonly string[];
  stageReadProtectedPaths: readonly string[];
}

export interface ReviewSandboxPolicy {
  extraWriteProtectedPaths: string[];
  extraReadProtectedPaths: string[];
}

export function composeReviewSandboxPolicy(
  input: ComposeReviewSandboxPolicyInput,
): ReviewSandboxPolicy {
  const {
    runWorkspaceAbsolute,
    stageWriteProtectedPaths,
    stageReadProtectedPaths,
  } = input;

  return {
    extraWriteProtectedPaths: dedupePaths([
      runWorkspaceAbsolute,
      ...stageWriteProtectedPaths,
    ]),
    extraReadProtectedPaths: dedupePaths(stageReadProtectedPaths),
  };
}

function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    deduped.push(path);
  }
  return deduped;
}
