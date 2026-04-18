import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  clearActiveInteractive,
  registerActiveInteractive,
} from "../../../src/commands/interactive/lifecycle.js";
import {
  clearActiveMessage,
  registerActiveMessage,
} from "../../../src/commands/message/lifecycle.js";
import {
  clearActiveReduce,
  registerActiveReduce,
} from "../../../src/commands/reduce/lifecycle.js";
import {
  clearActiveRun,
  registerActiveRun,
} from "../../../src/commands/run/lifecycle.js";
import {
  registerActiveSessionTeardown,
  snapshotActiveSessionTeardowns,
  terminateRegisteredActiveSessions,
} from "../../../src/commands/shared/teardown-registry.js";
import {
  clearActiveSpec,
  registerActiveSpec,
} from "../../../src/commands/spec/lifecycle.js";
import {
  clearActiveVerification,
  registerActiveVerification,
} from "../../../src/commands/verify/lifecycle.js";

describe("session teardown registry", () => {
  afterEach(() => {
    clearActiveRun("run-123");
    clearActiveVerification("verify-123");
    clearActiveInteractive("interactive-123");
    clearActiveMessage("message-123");
    clearActiveSpec("spec-123");
    clearActiveReduce("reduce-123");
  });

  it("covers the audited live session-backed operator surface", () => {
    registerActiveSpec({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      specId: "spec-123",
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: "run-123",
    });
    registerActiveReduce({
      root: "/repo",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      reductionId: "reduce-123",
    });
    registerActiveVerification({
      root: "/repo",
      verificationsFilePath: "/repo/.voratiq/verify/index.json",
      verificationId: "verify-123",
    });
    registerActiveMessage({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      messageId: "message-123",
    });
    registerActiveInteractive({
      root: "/repo",
      sessionId: "interactive-123",
    });

    const registrations = snapshotActiveSessionTeardowns().map(
      (registration) => registration.label,
    );

    expect(registrations).toEqual([
      "spec",
      "run",
      "reduce",
      "verify",
      "message",
      "interactive",
    ]);
  });

  it("aggregates teardown errors without short-circuiting later participants", async () => {
    const callOrder: string[] = [];
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const clearFirst = registerActiveSessionTeardown({
      key: "first",
      label: "first",
      terminate: () => {
        callOrder.push("first");
        throw new Error("first failed");
      },
    });
    const clearSecond = registerActiveSessionTeardown({
      key: "second",
      label: "second",
      terminate: () => {
        callOrder.push("second");
        throw new Error("second failed");
      },
    });

    try {
      const error = await terminateRegisteredActiveSessions(
        "failed",
        "uncaught exception",
      );

      expect(callOrder).toEqual(["first", "second"]);
      expect(error).toBeInstanceOf(AggregateError);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    } finally {
      clearFirst();
      clearSecond();
      consoleErrorSpy.mockRestore();
    }
  });
});
