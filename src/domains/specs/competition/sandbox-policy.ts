export interface ComposeSpecSandboxPolicyInput {
  stageWriteProtectedPaths?: readonly string[];
  stageReadProtectedPaths?: readonly string[];
}

export interface SpecSandboxPolicy {
  extraWriteProtectedPaths: string[];
  extraReadProtectedPaths: string[];
}

export function composeSpecSandboxPolicy(
  input: ComposeSpecSandboxPolicyInput = {},
): SpecSandboxPolicy {
  const { stageWriteProtectedPaths = [], stageReadProtectedPaths = [] } = input;

  return {
    extraWriteProtectedPaths: [...stageWriteProtectedPaths],
    extraReadProtectedPaths: [...stageReadProtectedPaths],
  };
}
