import { jest } from "@jest/globals";

describe("CLI process guards", () => {
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("installs SIGHUP alongside the existing signal handlers", async () => {
    const processOnceSpy = jest
      .spyOn(process, "once")
      .mockImplementation(() => process);
    const processOnSpy = jest
      .spyOn(process, "on")
      .mockImplementation(() => process);

    try {
      const { runCli } = await import("../../src/bin.js");
      await runCli(["node", "voratiq", "--version"]);

      expect(processOnceSpy).toHaveBeenCalledWith(
        "SIGHUP",
        expect.any(Function),
      );
      expect(processOnceSpy).toHaveBeenCalledWith(
        "SIGINT",
        expect.any(Function),
      );
      expect(processOnceSpy).toHaveBeenCalledWith(
        "SIGTERM",
        expect.any(Function),
      );
      expect(processOnSpy).toHaveBeenCalledWith(
        "uncaughtException",
        expect.any(Function),
      );
      expect(processOnSpy).toHaveBeenCalledWith(
        "unhandledRejection",
        expect.any(Function),
      );
    } finally {
      processOnceSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
