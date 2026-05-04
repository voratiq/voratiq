import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import { openExternalUrl } from "../../src/app-session/browser.js";

jest.mock("node:child_process", () => ({
  spawn: jest.fn(),
}));

const spawnMock = jest.mocked(spawn);

type MockChild = EventEmitter & Pick<ChildProcess, "unref">;

function createChildProcess(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.unref = jest.fn();
  return child;
}

describe("openExternalUrl", () => {
  const originalDisableBrowserOpen = process.env.VORATIQ_DISABLE_BROWSER_OPEN;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VORATIQ_DISABLE_BROWSER_OPEN;
  });

  afterAll(() => {
    if (originalDisableBrowserOpen === undefined) {
      delete process.env.VORATIQ_DISABLE_BROWSER_OPEN;
    } else {
      process.env.VORATIQ_DISABLE_BROWSER_OPEN = originalDisableBrowserOpen;
    }
  });

  it("resolves true once the opener process spawns", async () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const opened = openExternalUrl("https://app.voratiq.test/auth");

    child.emit("spawn");

    await expect(opened).resolves.toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it("resolves false when the opener emits an async error", async () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const opened = openExternalUrl("https://app.voratiq.test/auth");

    child.emit(
      "error",
      Object.assign(new Error("missing opener"), { code: "ENOENT" }),
    );

    await expect(opened).resolves.toBe(false);
    expect(child.unref).toHaveBeenCalled();
  });

  it("resolves false when spawn throws synchronously", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failure");
    });

    await expect(
      openExternalUrl("https://app.voratiq.test/auth"),
    ).resolves.toBe(false);
  });

  it("skips spawning when browser opening is disabled", async () => {
    process.env.VORATIQ_DISABLE_BROWSER_OPEN = "1";

    await expect(
      openExternalUrl("https://app.voratiq.test/auth"),
    ).resolves.toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
