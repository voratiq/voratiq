import { PassThrough } from "node:stream";

import { describe, expect, it, jest } from "@jest/globals";

import { showUpdatePrompt } from "../../../src/update-check/prompt.js";

function createStdinWithResponses(responses: string[]): NodeJS.ReadableStream {
  const stream = new PassThrough();
  let index = 0;

  // Feed responses on next tick so readline has time to set up
  const pushNext = (): void => {
    if (index < responses.length) {
      setTimeout(() => {
        stream.write(responses[index] + "\n");
        index++;
      }, 10);
    }
  };

  // Push first response immediately after construction
  pushNext();

  // Push subsequent responses when data is consumed
  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "data") {
      const wrapped = (...args: unknown[]) => {
        listener(...args);
        pushNext();
      };
      return originalOn(event, wrapped);
    }
    return originalOn(event, listener);
  }) as typeof stream.on;

  return stream;
}

describe("showUpdatePrompt", () => {
  const notice = "Update available: Voratiq 0.4.0 -> 0.5.0";

  it("Enter (empty input) selects default [1] and runs update", async () => {
    const stdin = createStdinWithResponses([""]);
    const stdout = new PassThrough();
    const execMock = jest.fn();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

    const result = await showUpdatePrompt(notice, {
      stdin,
      stdout,
      execCommand: execMock,
    });

    expect(result).toBe(true);
    expect(execMock).toHaveBeenCalledWith("npm install -g voratiq@latest");
    const output = chunks.join("");
    expect(output).toContain("Update available: Voratiq 0.4.0 -> 0.5.0");
    expect(output).toContain("[1] Update now");
    expect(output).toContain("[2] Skip");
    expect(output).toContain("Updating Voratiq via");
    expect(output).toContain("Update completed. Please rerun your command.");
  });

  it("input '1' runs update", async () => {
    const stdin = createStdinWithResponses(["1"]);
    const stdout = new PassThrough();
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      stdin,
      stdout,
      execCommand: execMock,
    });

    expect(result).toBe(true);
    expect(execMock).toHaveBeenCalledWith("npm install -g voratiq@latest");
  });

  it("input '2' skips and continues", async () => {
    const stdin = createStdinWithResponses(["2"]);
    const stdout = new PassThrough();
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      stdin,
      stdout,
      execCommand: execMock,
    });

    expect(result).toBe(false);
    expect(execMock).not.toHaveBeenCalled();
  });

  it("invalid input shows retry then accepts valid input", async () => {
    const stdin = createStdinWithResponses(["x", "2"]);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const execMock = jest.fn();

    const result = await showUpdatePrompt(notice, {
      stdin,
      stdout,
      execCommand: execMock,
    });

    expect(result).toBe(false);
    const output = chunks.join("");
    expect(output).toContain("Please choose 1 or 2.");
  });
});
