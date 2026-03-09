export interface ComposeReviewSandboxPolicyInput {
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
  const { stageWriteProtectedPaths, stageReadProtectedPaths } = input;

  return {
    extraWriteProtectedPaths: [...stageWriteProtectedPaths],
    extraReadProtectedPaths: [...stageReadProtectedPaths],
  };
}
