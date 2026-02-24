import { WorkspaceSetupError } from "../../workspace/errors.js";

export const DEFAULT_SANDBOX_ERROR_CONTEXT = "Invalid `sandbox.yaml`" as const;

export class SandboxConfigurationError extends WorkspaceSetupError {
  constructor(detail: string) {
    super(detail);
    this.name = "SandboxConfigurationError";
  }
}
