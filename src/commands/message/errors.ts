export class MessageAgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Message agent not found: ${agentId}`);
    this.name = "MessageAgentNotFoundError";
  }
}

export class MessageGenerationFailedError extends Error {
  constructor(details: readonly string[]) {
    super(
      details.length > 0
        ? `Message execution failed: ${details.join("; ")}`
        : "Message execution failed.",
    );
    this.name = "MessageGenerationFailedError";
  }
}

export class MessageInvocationContextError extends Error {
  constructor() {
    super("`message` cannot be invoked from inside a batch agent workspace.");
    this.name = "MessageInvocationContextError";
  }
}
