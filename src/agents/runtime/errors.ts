import { DisplayableError } from "../../utils/errors.js";

export type AgentRuntimeErrorKind = "auth" | "manifest" | "sandbox" | "process";

export class AgentRuntimeError extends DisplayableError {
  public readonly kind: AgentRuntimeErrorKind;

  constructor(kind: AgentRuntimeErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "AgentRuntimeError";
  }
}

export class MissingAgentProviderError extends AgentRuntimeError {
  constructor(agentId: string) {
    super("auth", `Agent "${agentId}" missing provider.`);
    this.name = "MissingAgentProviderError";
  }
}

export class UnknownAuthProviderError extends AgentRuntimeError {
  constructor(providerId: string) {
    super("auth", `Unknown auth provider "${providerId}".`);
    this.name = "UnknownAuthProviderError";
  }
}

export class AuthProviderVerificationError extends AgentRuntimeError {
  constructor(detail: string) {
    super("auth", detail);
    this.name = "AuthProviderVerificationError";
  }
}

export class AuthProviderStageError extends AgentRuntimeError {
  constructor(detail: string) {
    super("auth", detail);
    this.name = "AuthProviderStageError";
  }
}

export class AgentRuntimeManifestError extends AgentRuntimeError {
  constructor(detail: string) {
    super("manifest", detail);
    this.name = "AgentRuntimeManifestError";
  }
}

export class AgentRuntimeSandboxError extends AgentRuntimeError {
  constructor(detail: string) {
    super("sandbox", detail);
    this.name = "AgentRuntimeSandboxError";
  }
}

export class AgentRuntimeProcessError extends AgentRuntimeError {
  constructor(detail: string) {
    super("process", detail);
    this.name = "AgentRuntimeProcessError";
  }
}
