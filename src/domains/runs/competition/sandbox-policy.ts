export interface ComposeRunSandboxPolicyInput {
  stageWriteProtectedPaths: readonly string[];
  stageReadProtectedPaths: readonly string[];
}

export interface RunSandboxPolicy {
  extraWriteProtectedPaths: string[];
  extraReadProtectedPaths: string[];
}

export function composeRunSandboxPolicy(
  input: ComposeRunSandboxPolicyInput,
): RunSandboxPolicy {
  const { stageWriteProtectedPaths, stageReadProtectedPaths } = input;

  return {
    extraWriteProtectedPaths: [...stageWriteProtectedPaths],
    extraReadProtectedPaths: [...stageReadProtectedPaths],
  };
}
