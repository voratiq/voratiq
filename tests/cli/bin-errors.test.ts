import { readFileSync } from "node:fs";

import { jest } from "@jest/globals";

import { toCliError } from "../../src/cli/errors.js";
import { renderCliError } from "../../src/render/utils/errors.js";
import {
  WorkspaceMissingEntryError,
  WorkspaceNotInitializedError,
} from "../../src/workspace/errors.js";

describe("CLI entrypoint error handling", () => {
  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;
  let runCli!: (argv?: readonly string[]) => Promise<void>;

  beforeEach(() => {
    originalExitCode = process.exitCode;
  });

  beforeAll(async () => {
    ({ runCli } = await import("../../src/bin.js"));
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("renders workspace missing entry hint", () => {
    const cliError = toCliError(
      new WorkspaceMissingEntryError(".voratiq/agents.yaml"),
    );
    expect(cliError.hintLines).toEqual([
      "Run `voratiq init` to configure the workspace.",
    ]);

    const rendered = renderCliError(cliError);
    expect(rendered).toContain("Missing workspace entry: .voratiq/agents.yaml");
    expect(rendered).toContain(
      "Run `voratiq init` to configure the workspace.",
    );
  });

  it("renders workspace not initialized details and hint", () => {
    const cliError = toCliError(
      new WorkspaceNotInitializedError([
        ".voratiq/",
        ".voratiq/runs/",
        ".voratiq/runs/index.json",
      ]),
    );

    expect(cliError.detailLines).toEqual([
      "Missing workspace entries:",
      "  - .voratiq/",
      "  - .voratiq/runs/",
      "  - .voratiq/runs/index.json",
    ]);
    expect(cliError.hintLines).toEqual([
      "Run `voratiq init` from the repository root and rerun.",
    ]);

    const rendered = renderCliError(cliError);
    expect(rendered).toContain("Voratiq workspace not found; aborting run.");
    expect(rendered).toContain("Missing workspace entries:");
    expect(rendered).toContain(".voratiq/runs/index.json");
    expect(rendered).toContain(
      "Run `voratiq init` from the repository root and rerun.",
    );
  });

  it("does not duplicate Commander usage errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    await runCli(["node", "voratiq", "runs"]);

    const combinedStderr = stderr.join("");
    expect(stdout).toHaveLength(0);
    const occurrences =
      combinedStderr.match(/error: unknown command 'runs'/gu) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(process.exitCode).toBe(1);
  });

  it("prints the CLI version for -v/--version", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    await runCli(["node", "voratiq", "--version"]);

    const packageJsonRaw = readFileSync(
      new URL("../../package.json", import.meta.url),
      "utf-8",
    );
    const { version } = JSON.parse(packageJsonRaw) as { version: string };

    expect(stdout.join("").trim()).toBe(version);
    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });
});
