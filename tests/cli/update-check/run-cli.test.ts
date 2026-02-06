import { spawnSync } from "node:child_process";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { runCli } from "../../../src/bin.js";
import type { ConfirmationInteractor } from "../../../src/render/interactions/confirmation.js";
import * as confirmation from "../../../src/render/interactions/confirmation.js";
import type { UpdateHandle } from "../../../src/update-check/mvp.js";
import * as updateCheck from "../../../src/update-check/mvp.js";
import * as updateStatePath from "../../../src/update-check/state-path.js";

jest.mock("node:child_process", () => ({
  spawnSync: jest.fn(),
}));

jest.mock("../../../src/utils/version.js", () => ({
  getVoratiqVersion: jest.fn(() => "0.4.2"),
}));

jest.mock("../../../src/update-check/mvp.js", () => ({
  startUpdateCheck: jest.fn(),
}));

jest.mock("../../../src/update-check/state-path.js", () => ({
  resolveUpdateStatePath: jest.fn(() => "/tmp/voratiq/update-state.json"),
}));

jest.mock("../../../src/render/interactions/confirmation.js", () => ({
  createConfirmationInteractor: jest.fn(),
}));

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function createUpdateHandle(
  notice: string,
): UpdateHandle & { finishSpy: jest.Mock } {
  let remainingNotice: string | undefined = notice;
  const finishSpy = jest.fn();
  return {
    peekNotice(): string | undefined {
      const current = remainingNotice;
      remainingNotice = undefined;
      return current;
    },
    finish: finishSpy,
    finishSpy,
  };
}

function createInteractorMock(response: string): {
  interactor: ConfirmationInteractor;
  close: jest.Mock;
} {
  const close = jest.fn();
  const interactor: ConfirmationInteractor = {
    confirm: () => Promise.resolve(true),
    prompt: () => Promise.resolve(response),
    close,
  };
  return { interactor, close };
}

describe("runCli update-check prompt flow", () => {
  const startUpdateCheckMock = jest.mocked(updateCheck.startUpdateCheck);
  const resolveUpdateStatePathMock = jest.mocked(
    updateStatePath.resolveUpdateStatePath,
  );
  const createConfirmationInteractorMock = jest.mocked(
    confirmation.createConfirmationInteractor,
  );
  const spawnSyncMock = jest.mocked(spawnSync);

  let stdout: string[];
  let stderr: string[];
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    startUpdateCheckMock.mockReset();
    resolveUpdateStatePathMock.mockReset();
    resolveUpdateStatePathMock.mockReturnValue(
      "/tmp/voratiq/update-state.json",
    );
    createConfirmationInteractorMock.mockReset();
    spawnSyncMock.mockReset();

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("continues to command execution when user selects Skip", async () => {
    const handle = createUpdateHandle(
      "Update available: Voratiq 0.4.2 -> 0.5.0",
    );
    startUpdateCheckMock.mockReturnValue(handle);

    const { interactor, close } = createInteractorMock("2");
    createConfirmationInteractorMock.mockReturnValue(interactor);

    await runCli(["node", "voratiq", "--version"]);

    expect(stripAnsi(stdout.join(""))).toContain("0.4.2");
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(handle.finishSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
  });

  it("runs update and skips command execution when user selects Update now", async () => {
    const handle = createUpdateHandle(
      "Update available: Voratiq 0.4.2 -> 0.5.0",
    );
    startUpdateCheckMock.mockReturnValue(handle);

    const { interactor, close } = createInteractorMock("1");
    createConfirmationInteractorMock.mockReturnValue(interactor);
    spawnSyncMock.mockReturnValue({
      error: undefined,
      signal: null,
      status: 0,
    } as never);

    await runCli(["node", "voratiq", "--version"]);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "voratiq@latest"],
      { stdio: "inherit" },
    );
    expect(stripAnsi(stdout.join(""))).toContain(
      "Update completed. Please rerun your command.",
    );
    expect(stripAnsi(stdout.join(""))).not.toContain("0.4.2");
    expect(close).toHaveBeenCalledTimes(1);
    expect(handle.finishSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("sets non-zero exit and skips command execution when update fails", async () => {
    const handle = createUpdateHandle(
      "Update available: Voratiq 0.4.2 -> 0.5.0",
    );
    startUpdateCheckMock.mockReturnValue(handle);

    const { interactor, close } = createInteractorMock("1");
    createConfirmationInteractorMock.mockReturnValue(interactor);
    spawnSyncMock.mockReturnValue({
      error: undefined,
      signal: null,
      status: 1,
    } as never);

    await runCli(["node", "voratiq", "--version"]);

    expect(stripAnsi(stdout.join(""))).toContain(
      "Update failed. Please try again manually.",
    );
    expect(stripAnsi(stdout.join(""))).not.toContain("0.4.2");
    expect(handle.finishSpy).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
