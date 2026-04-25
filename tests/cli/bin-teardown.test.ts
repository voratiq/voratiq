import { jest } from "@jest/globals";

jest.mock("../../src/commands/shared/teardown-registry.js", () => ({
  terminateRegisteredActiveSessions: jest.fn(),
}));

jest.mock("../../src/domain/spec/persistence/adapter.js", () => ({
  flushAllSpecRecordBuffers: jest.fn(),
}));

jest.mock("../../src/domain/run/persistence/adapter.js", () => ({
  flushAllRunRecordBuffers: jest.fn(),
}));

jest.mock("../../src/domain/reduce/persistence/adapter.js", () => ({
  flushAllReductionRecordBuffers: jest.fn(),
}));

jest.mock("../../src/domain/verify/persistence/adapter.js", () => ({
  flushAllVerificationRecordBuffers: jest.fn(),
}));

jest.mock("../../src/domain/message/persistence/adapter.js", () => ({
  flushAllMessageRecordBuffers: jest.fn(),
}));

jest.mock("../../src/domain/interactive/persistence/adapter.js", () => ({
  flushAllInteractiveSessionBuffers: jest.fn(),
}));

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("CLI teardown dispatch", () => {
  it("routes signal and fatal handlers through the shared registry and flushes every audited history buffer", async () => {
    jest.resetModules();

    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      process.exitCode = code ?? 0;
      return undefined as never;
    }) as typeof process.exit);

    const signalHandlers = new Map<string, () => void>();
    const errorHandlers = new Map<string, (error: unknown) => void>();
    const processOnceSpy = jest
      .spyOn(process, "once")
      .mockImplementation((event, handler) => {
        signalHandlers.set(String(event), handler as () => void);
        return process;
      });
    const processOnSpy = jest
      .spyOn(process, "on")
      .mockImplementation((event, handler) => {
        errorHandlers.set(String(event), handler as (error: unknown) => void);
        return process;
      });

    try {
      const { terminateRegisteredActiveSessions } =
        await import("../../src/commands/shared/teardown-registry.js");
      const { flushAllSpecRecordBuffers } =
        await import("../../src/domain/spec/persistence/adapter.js");
      const { flushAllRunRecordBuffers } =
        await import("../../src/domain/run/persistence/adapter.js");
      const { flushAllReductionRecordBuffers } =
        await import("../../src/domain/reduce/persistence/adapter.js");
      const { flushAllVerificationRecordBuffers } =
        await import("../../src/domain/verify/persistence/adapter.js");
      const { flushAllMessageRecordBuffers } =
        await import("../../src/domain/message/persistence/adapter.js");
      const { flushAllInteractiveSessionBuffers } =
        await import("../../src/domain/interactive/persistence/adapter.js");

      const terminateRegisteredActiveSessionsMock = jest.mocked(
        terminateRegisteredActiveSessions,
      );
      const flushAllSpecRecordBuffersMock = jest.mocked(
        flushAllSpecRecordBuffers,
      );
      const flushAllRunRecordBuffersMock = jest.mocked(
        flushAllRunRecordBuffers,
      );
      const flushAllReductionRecordBuffersMock = jest.mocked(
        flushAllReductionRecordBuffers,
      );
      const flushAllVerificationRecordBuffersMock = jest.mocked(
        flushAllVerificationRecordBuffers,
      );
      const flushAllMessageRecordBuffersMock = jest.mocked(
        flushAllMessageRecordBuffers,
      );
      const flushAllInteractiveSessionBuffersMock = jest.mocked(
        flushAllInteractiveSessionBuffers,
      );

      terminateRegisteredActiveSessionsMock.mockResolvedValue(null);
      flushAllSpecRecordBuffersMock.mockResolvedValue(undefined);
      flushAllRunRecordBuffersMock.mockResolvedValue(undefined);
      flushAllReductionRecordBuffersMock.mockResolvedValue(undefined);
      flushAllVerificationRecordBuffersMock.mockResolvedValue(undefined);
      flushAllMessageRecordBuffersMock.mockResolvedValue(undefined);
      flushAllInteractiveSessionBuffersMock.mockResolvedValue(undefined);

      const { runCli } = await import("../../src/bin.js");
      await runCli(["node", "voratiq", "--version"]);

      signalHandlers.get("SIGINT")?.();
      await flushAsyncWork();

      expect(terminateRegisteredActiveSessionsMock).toHaveBeenCalledWith(
        "aborted",
        "SIGINT",
      );
      expect(flushAllSpecRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllRunRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllReductionRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllVerificationRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllMessageRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllInteractiveSessionBuffersMock).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenLastCalledWith(130);

      terminateRegisteredActiveSessionsMock.mockClear();
      flushAllSpecRecordBuffersMock.mockClear();
      flushAllRunRecordBuffersMock.mockClear();
      flushAllReductionRecordBuffersMock.mockClear();
      flushAllVerificationRecordBuffersMock.mockClear();
      flushAllMessageRecordBuffersMock.mockClear();
      flushAllInteractiveSessionBuffersMock.mockClear();
      processExitSpy.mockClear();

      errorHandlers.get("uncaughtException")?.(new Error("boom"));
      await flushAsyncWork();

      expect(terminateRegisteredActiveSessionsMock).toHaveBeenCalledWith(
        "failed",
        "uncaught exception",
      );
      expect(flushAllSpecRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllRunRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllReductionRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllVerificationRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllMessageRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllInteractiveSessionBuffersMock).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenLastCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processOnceSpy).toHaveBeenCalledWith(
        "SIGINT",
        expect.any(Function),
      );
      expect(processOnSpy).toHaveBeenCalledWith(
        "uncaughtException",
        expect.any(Function),
      );
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
      processOnceSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });

  it("keeps SIGINT teardown in control until abort persistence finishes", async () => {
    jest.resetModules();

    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      process.exitCode = code ?? 0;
      return undefined as never;
    }) as typeof process.exit);

    const signalHandlers = new Map<string, () => void>();
    const processOnceSpy = jest
      .spyOn(process, "once")
      .mockImplementation((event, handler) => {
        signalHandlers.set(String(event), handler as () => void);
        return process;
      });
    const processOnSpy = jest
      .spyOn(process, "on")
      .mockImplementation(() => process);

    try {
      const { terminateRegisteredActiveSessions } =
        await import("../../src/commands/shared/teardown-registry.js");
      const { flushAllSpecRecordBuffers } =
        await import("../../src/domain/spec/persistence/adapter.js");
      const { flushAllRunRecordBuffers } =
        await import("../../src/domain/run/persistence/adapter.js");
      const { flushAllReductionRecordBuffers } =
        await import("../../src/domain/reduce/persistence/adapter.js");
      const { flushAllVerificationRecordBuffers } =
        await import("../../src/domain/verify/persistence/adapter.js");
      const { flushAllMessageRecordBuffers } =
        await import("../../src/domain/message/persistence/adapter.js");
      const { flushAllInteractiveSessionBuffers } =
        await import("../../src/domain/interactive/persistence/adapter.js");

      const terminateRegisteredActiveSessionsMock = jest.mocked(
        terminateRegisteredActiveSessions,
      );
      const flushAllSpecRecordBuffersMock = jest.mocked(
        flushAllSpecRecordBuffers,
      );
      const flushAllRunRecordBuffersMock = jest.mocked(
        flushAllRunRecordBuffers,
      );
      const flushAllReductionRecordBuffersMock = jest.mocked(
        flushAllReductionRecordBuffers,
      );
      const flushAllVerificationRecordBuffersMock = jest.mocked(
        flushAllVerificationRecordBuffers,
      );
      const flushAllMessageRecordBuffersMock = jest.mocked(
        flushAllMessageRecordBuffers,
      );
      const flushAllInteractiveSessionBuffersMock = jest.mocked(
        flushAllInteractiveSessionBuffers,
      );

      let resolveTermination!: (error: Error | null) => void;
      const terminationPromise = new Promise<Error | null>((resolve) => {
        resolveTermination = resolve;
      });

      terminateRegisteredActiveSessionsMock.mockReturnValue(terminationPromise);
      flushAllSpecRecordBuffersMock.mockResolvedValue(undefined);
      flushAllRunRecordBuffersMock.mockResolvedValue(undefined);
      flushAllReductionRecordBuffersMock.mockResolvedValue(undefined);
      flushAllVerificationRecordBuffersMock.mockResolvedValue(undefined);
      flushAllMessageRecordBuffersMock.mockResolvedValue(undefined);
      flushAllInteractiveSessionBuffersMock.mockResolvedValue(undefined);

      const { runCli } = await import("../../src/bin.js");
      await runCli(["node", "voratiq", "--version"]);

      signalHandlers.get("SIGINT")?.();
      await flushAsyncWork();

      expect(terminateRegisteredActiveSessionsMock).toHaveBeenCalledTimes(1);
      expect(terminateRegisteredActiveSessionsMock).toHaveBeenCalledWith(
        "aborted",
        "SIGINT",
      );
      expect(processExitSpy).not.toHaveBeenCalled();

      signalHandlers.get("SIGINT")?.();
      await flushAsyncWork();

      expect(terminateRegisteredActiveSessionsMock).toHaveBeenCalledTimes(1);
      expect(processExitSpy).not.toHaveBeenCalled();
      expect(
        processOnceSpy.mock.calls.filter(([event]) => event === "SIGINT"),
      ).toHaveLength(3);

      resolveTermination(null);
      await flushAsyncWork();
      await flushAsyncWork();

      expect(flushAllSpecRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllRunRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllReductionRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllVerificationRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllMessageRecordBuffersMock).toHaveBeenCalledTimes(1);
      expect(flushAllInteractiveSessionBuffersMock).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenLastCalledWith(130);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      processExitSpy.mockRestore();
      processOnceSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
