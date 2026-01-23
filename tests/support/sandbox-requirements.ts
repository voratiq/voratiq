import { hasSandboxDependencies } from "../../src/workspace/sandbox-requirements.js";

if (process.env.SRT_DEBUG === undefined) {
  process.env.SRT_DEBUG = "";
}

export function isSandboxRuntimeSupported(): boolean {
  return hasSandboxDependencies();
}

// Skip sandbox tests when running from inside a workspace - spawning sandboxes is
// structurally impossible from within a sandboxed environment.
const cwd = process.cwd().replace(/\\/g, "/");
const runningInWorkspace = cwd.includes("/.voratiq/runs/");

const sandboxSuiteEnabled = isSandboxRuntimeSupported() && !runningInWorkspace;

export const sandboxSuite: typeof describe = sandboxSuiteEnabled
  ? describe
  : describe.skip;

export const sandboxTest: typeof it = sandboxSuiteEnabled ? it : it.skip;

export async function withSandboxEnabled<T>(fn: () => Promise<T>): Promise<T> {
  return await fn();
}
