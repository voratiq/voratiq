import { jest } from "@jest/globals";

import * as applyCli from "../../src/cli/apply.js";
import { runAutoCommand } from "../../src/cli/auto.js";
import * as runCli from "../../src/cli/run.js";
import * as specCli from "../../src/cli/spec.js";
import * as verifyCli from "../../src/cli/verify.js";
import * as autoCommandModule from "../../src/commands/auto/command.js";

jest.mock("../../src/commands/auto/command.js", () => ({
  executeAutoCommand: jest.fn(),
}));

jest.mock("../../src/cli/run.js", () => ({
  runRunCommand: jest.fn(),
}));

jest.mock("../../src/cli/spec.js", () => ({
  runSpecCommand: jest.fn(),
}));

jest.mock("../../src/cli/verify.js", () => ({
  runVerifyCommand: jest.fn(),
}));

jest.mock("../../src/cli/apply.js", () => ({
  runApplyCommand: jest.fn(),
}));

describe("runAutoCommand boundary", () => {
  const executeAutoCommandMock = jest.mocked(
    autoCommandModule.executeAutoCommand,
  );

  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  beforeEach(() => {
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    executeAutoCommandMock.mockReset();
    jest.mocked(runCli.runRunCommand).mockReset();
    jest.mocked(specCli.runSpecCommand).mockReset();
    jest.mocked(verifyCli.runVerifyCommand).mockReset();
    jest.mocked(applyCli.runApplyCommand).mockReset();
  });

  afterEach(() => {
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("delegates orchestration sequencing to the application layer", async () => {
    executeAutoCommandMock.mockResolvedValue({
      exitCode: 0,
      runId: "run-1",
      auto: { status: "succeeded" },
      apply: { status: "skipped" },
      summary: {
        status: "succeeded",
        totalDurationMs: 0,
        spec: { status: "skipped" },
        run: { status: "succeeded", runId: "run-1" },
        verify: { status: "skipped" },
        apply: { status: "skipped" },
      },
      events: [],
    });

    await runAutoCommand({
      specPath: "specs/task.md",
    });

    expect(executeAutoCommandMock).toHaveBeenCalledWith(
      { specPath: "specs/task.md" },
      expect.any(Object),
    );
    const dependencies = executeAutoCommandMock.mock.calls[0]?.[1];
    expect(dependencies).toBeDefined();
    expect(typeof dependencies?.runSpecStage).toBe("function");
    expect(typeof dependencies?.runRunStage).toBe("function");
    expect(typeof dependencies?.runVerifyStage).toBe("function");
    expect(typeof dependencies?.runApplyStage).toBe("function");
    expect(jest.mocked(runCli.runRunCommand)).not.toHaveBeenCalled();
    expect(jest.mocked(specCli.runSpecCommand)).not.toHaveBeenCalled();
    expect(jest.mocked(verifyCli.runVerifyCommand)).not.toHaveBeenCalled();
    expect(jest.mocked(applyCli.runApplyCommand)).not.toHaveBeenCalled();
  });
});
