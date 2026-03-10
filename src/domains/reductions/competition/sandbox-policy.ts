export interface ComposeReduceSandboxPolicyInput {
  stageWriteProtectedPaths: readonly string[];
  stageReadProtectedPaths: readonly string[];
}

export interface ReduceSandboxPolicy {
  extraWriteProtectedPaths: string[];
  extraReadProtectedPaths: string[];
}

export function composeReduceSandboxPolicy(
  input: ComposeReduceSandboxPolicyInput,
): ReduceSandboxPolicy {
  const { stageWriteProtectedPaths, stageReadProtectedPaths } = input;

  return {
    extraWriteProtectedPaths: [...stageWriteProtectedPaths],
    extraReadProtectedPaths: [...stageReadProtectedPaths],
  };
}
