import { hasSandboxDependencies } from "../../src/workspace/sandbox-requirements.js";

export function isSandboxRuntimeSupported(): boolean {
  return hasSandboxDependencies();
}

const sandboxSuiteEnabled = isSandboxRuntimeSupported();

export const sandboxSuite: typeof describe = sandboxSuiteEnabled
  ? describe
  : describe.skip;

export const sandboxTest: typeof it = sandboxSuiteEnabled ? it : it.skip;

export async function withSandboxEnabled<T>(fn: () => Promise<T>): Promise<T> {
  return await fn();
}
