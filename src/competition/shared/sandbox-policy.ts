export interface ComposeStageSandboxPolicyInput {
  stageWriteProtectedPaths?: readonly string[];
  stageReadProtectedPaths?: readonly string[];
}

export interface StageSandboxPolicy {
  extraWriteProtectedPaths: string[];
  extraReadProtectedPaths: string[];
}

export function composeStageSandboxPolicy(
  input: ComposeStageSandboxPolicyInput = {},
): StageSandboxPolicy {
  const { stageWriteProtectedPaths = [], stageReadProtectedPaths = [] } = input;

  return {
    extraWriteProtectedPaths: [...stageWriteProtectedPaths],
    extraReadProtectedPaths: [...stageReadProtectedPaths],
  };
}
