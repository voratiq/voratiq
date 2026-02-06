import { describe, expect, it, jest } from "@jest/globals";

import type {
  UpdatePromptHandler,
  UpdatePromptWriter,
} from "../../../src/update-check/prompt.js";
import { showUpdatePrompt } from "../../../src/update-check/prompt.js";

function createMockPrompt(
  responses: string[],
): UpdatePromptHandler & {
  calls: { message: string; prefaceLines?: string[] }[];
} {
  let index = 0;
  const calls: { message: string; prefaceLines?: string[] }[] = [];

  const handler = (opts: {
    message: string;
    prefaceLines?: string[];
  }): Promise<string> => {
    calls.push(opts);
    const response = responses[index] ?? "";
    index++;
    return Promise.resolve(response);
  };

  return Object.assign(handler, { calls });
}

function createMockWriter(): UpdatePromptWriter & { getOutput(): string } {
  let output = "";
  const writer = (text: string): void => {
    output += text;
  };
  return Object.assign(writer, {
    getOutput() {
      return output;
    },
  });
}

describe("showUpdatePrompt", () => {
  const notice = "Update available: Voratiq 0.4.0 -> 0.5.0";

  it("Enter (empty input) selects default [1] and runs update", async () => {
    const prompt = createMockPrompt([""]);
    const write = createMockWriter();
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      prompt,
      write,
      execCommand: execMock,
    });

    expect(result.shouldExit).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(execMock).toHaveBeenCalledWith("npm install -g voratiq@latest");

    // Check preface lines contain expected content
    const firstCall = prompt.calls[0];
    expect(firstCall?.prefaceLines).toBeDefined();
    const preface = firstCall?.prefaceLines?.join("\n") ?? "";
    expect(preface).toContain("Update available: Voratiq 0.4.0 -> 0.5.0");
    expect(preface).toContain("[1] Update now");
    expect(preface).toContain("[2] Skip");

    // Check output
    expect(write.getOutput()).toContain("Updating Voratiq via");
    expect(write.getOutput()).toContain(
      "Update completed. Please rerun your command.",
    );
  });

  it("input '1' runs update", async () => {
    const prompt = createMockPrompt(["1"]);
    const write = createMockWriter();
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      prompt,
      write,
      execCommand: execMock,
    });

    expect(result.shouldExit).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(execMock).toHaveBeenCalledWith("npm install -g voratiq@latest");
  });

  it("input '2' skips and continues", async () => {
    const prompt = createMockPrompt(["2"]);
    const write = createMockWriter();
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      prompt,
      write,
      execCommand: execMock,
    });

    expect(result.shouldExit).toBe(false);
    expect(result.exitCode).toBeUndefined();
    expect(execMock).not.toHaveBeenCalled();
  });

  it("invalid input shows retry then accepts valid input", async () => {
    const prompt = createMockPrompt(["x", "2"]);
    const write = createMockWriter();
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      prompt,
      write,
      execCommand: execMock,
    });

    expect(result.shouldExit).toBe(false);
    expect(write.getOutput()).toContain("Please choose 1 or 2.");
    // Preface lines should only be present on first prompt
    expect(prompt.calls[0]?.prefaceLines).toBeDefined();
    expect(prompt.calls[1]?.prefaceLines).toBeUndefined();
  });

  it("returns exitCode 1 when update command fails", async () => {
    const prompt = createMockPrompt(["1"]);
    const write = createMockWriter();
    const execMock = jest.fn().mockImplementation(() => {
      throw new Error("npm failed");
    });

    const result = await showUpdatePrompt(notice, {
      prompt,
      write,
      execCommand: execMock,
    });

    expect(result.shouldExit).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(write.getOutput()).toContain("Update failed");
  });
});
