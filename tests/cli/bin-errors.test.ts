import { readFileSync } from "node:fs";

import { jest } from "@jest/globals";

import { toCliError } from "../../src/cli/errors.js";
import { renderCliError } from "../../src/render/utils/errors.js";
import {
  WorkspaceMissingEntryError,
  WorkspaceNotInitializedError,
  WorkspaceWrongTypeEntryError,
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
      "Run `voratiq doctor --fix` to repair workspace setup.",
    ]);

    const rendered = renderCliError(cliError);
    expect(rendered).toContain(
      "Missing workspace entry: `.voratiq/agents.yaml`.",
    );
    expect(rendered).toContain(
      "Run `voratiq doctor --fix` to repair workspace setup.",
    );
  });

  it("renders missing orchestration config UX exactly", () => {
    const cliError = toCliError(
      new WorkspaceMissingEntryError(".voratiq/orchestration.yaml"),
    );

    const rendered = stripAnsi(renderCliError(cliError));
    expect(rendered).toBe(
      [
        "Error: Missing workspace entry: `.voratiq/orchestration.yaml`.",
        "",
        "Run `voratiq doctor --fix` to repair workspace setup.",
      ].join("\n"),
    );
  });

  it("renders workspace wrong-type entry hint", () => {
    const cliError = toCliError(
      new WorkspaceWrongTypeEntryError(".voratiq/verify/index.json", "file"),
    );

    const rendered = stripAnsi(renderCliError(cliError));
    expect(rendered).toBe(
      [
        "Error: Wrong workspace entry type: `.voratiq/verify/index.json` must be a file.",
        "",
        "Run `voratiq doctor --fix` to repair workspace setup.",
      ].join("\n"),
    );
  });

  it("renders workspace not initialized details and hint", () => {
    const cliError = toCliError(
      new WorkspaceNotInitializedError([
        ".voratiq/",
        ".voratiq/run/sessions/",
        ".voratiq/run/index.json",
      ]),
    );

    expect(cliError.detailLines).toEqual([
      "Missing workspace entries:",
      "  - `.voratiq/`",
      "  - `.voratiq/run/sessions/`",
      "  - `.voratiq/run/index.json`",
    ]);
    expect(cliError.hintLines).toEqual([
      "Run `voratiq doctor --fix` to repair workspace setup.",
    ]);

    const rendered = renderCliError(cliError);
    expect(rendered).toContain("Voratiq workspace is not initialized.");
    expect(rendered).toContain("Missing workspace entries:");
    expect(rendered).toContain(".voratiq/run/index.json");
    expect(rendered).toContain(
      "Run `voratiq doctor --fix` to repair workspace setup.",
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

  it.each(["init", "sync"])(
    "treats `%s` like an unknown command",
    async (removedCommand) => {
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

      await runCli(["node", "voratiq", removedCommand]);

      expect(stdout).toHaveLength(0);
      expect(stderr.join("")).toContain(
        `error: unknown command '${removedCommand}'`,
      );
      expect(process.exitCode).toBe(1);
    },
  );

  it("emits a failed json envelope for prune without explicit confirmation", async () => {
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

    await runCli(["node", "voratiq", "prune", "--all", "--json"]);

    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBe(1);

    const envelope = JSON.parse(stdout.join("").trim()) as {
      version: number;
      operator: string;
      status: string;
      error?: { message: string };
    };

    expect(envelope).toMatchObject({
      version: 1,
      operator: "prune",
      status: "failed",
      error: {
        message: "JSON-mode prune requires explicit confirmation.",
      },
    });
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

  it("does not expose the old root description shortcut in help", async () => {
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

    await runCli(["node", "voratiq", "--help"]);

    const help = stripAnsi(stdout.join(""));
    expect(help).not.toContain("--description <text>");
    expect(help).not.toContain(
      "Describe what to build, then run the full pipeline",
    );
    expect(help).toContain("auto [options]");
    expect(help).toContain("doctor [options]");
    expect(help).not.toContain("init [options]");
    expect(help).not.toContain("sync [options]");
    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });
});

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  const ansiPattern = new RegExp(`${esc}\\[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
}
