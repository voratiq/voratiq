import {
  AgentProcessError,
  GitOperationError,
  WorkspaceSetupRunError,
} from "../../src/commands/run/errors.js";

describe("run errors", () => {
  it("formats workspace setup errors", () => {
    const error = new WorkspaceSetupRunError("Failed to create directory");
    expect(error.messageForDisplay()).toBe("Failed to create directory");
  });

  it("formats agent process errors without exit code", () => {
    const error = new AgentProcessError({});
    expect(error.messageForDisplay()).toBe(
      "Agent process failed. Please review the logs.",
    );
  });

  it("formats agent process errors with exit code", () => {
    const error = new AgentProcessError({ exitCode: 9 });
    expect(error.messageForDisplay()).toBe(
      "Agent process failed. Please review the logs. (exit code 9)",
    );
  });

  it("formats agent process errors with exit code and detail", () => {
    const error = new AgentProcessError({
      exitCode: 42,
      detail: "timeout exceeded",
    });
    expect(error.messageForDisplay()).toBe("timeout exceeded (exit code 42)");
  });

  it("formats git operation errors", () => {
    const error = new GitOperationError({
      operation: "Git commit failed",
      detail: "exit status 1",
    });
    expect(error.messageForDisplay()).toBe("Git commit failed: exit status 1");
  });
});
