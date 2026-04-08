import { jest } from "@jest/globals";

import { CliError } from "../../src/cli/errors.js";
import { GitRepositoryError } from "../../src/utils/errors.js";

const shouldStartRootLauncherMock = jest.fn();
const runInteractiveRootLauncherMock = jest.fn(() => Promise.resolve());

jest.mock("../../src/cli/root-launcher.js", () => ({
  shouldStartRootLauncher: shouldStartRootLauncherMock,
  runInteractiveRootLauncher: runInteractiveRootLauncherMock,
}));

describe("CLI root launcher wiring", () => {
  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;
  let runCli!: (argv?: readonly string[]) => Promise<void>;

  beforeAll(async () => {
    ({ runCli } = await import("../../src/bin.js"));
  });

  beforeEach(() => {
    originalExitCode = process.exitCode;
    shouldStartRootLauncherMock.mockReset();
    runInteractiveRootLauncherMock.mockReset();
    runInteractiveRootLauncherMock.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("invokes the interactive launcher for bare root invocation when eligible", async () => {
    shouldStartRootLauncherMock.mockReturnValue(true);

    await runCli(["node", "voratiq"]);

    expect(shouldStartRootLauncherMock).toHaveBeenCalledWith([
      "node",
      "voratiq",
    ]);
    expect(runInteractiveRootLauncherMock).toHaveBeenCalledTimes(1);
  });

  it("renders launcher failures through the normal CLI error path", async () => {
    shouldStartRootLauncherMock.mockReturnValue(true);
    runInteractiveRootLauncherMock.mockRejectedValue(
      new CliError("Launcher failed.", ["detail line"]),
    );

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

    await runCli(["node", "voratiq"]);

    expect(stdout.join("")).toContain("Launcher failed.");
    expect(stdout.join("")).toContain("detail line");
    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("falls back to help when bare voratiq is used outside a git repo", async () => {
    shouldStartRootLauncherMock.mockReturnValue(true);
    runInteractiveRootLauncherMock.mockRejectedValue(
      new GitRepositoryError(
        "No git repository found. Run `git init` or switch to an existing repository.",
        "no_repository",
      ),
    );

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

    await runCli(["node", "voratiq"]);

    expect(stdout.join("")).toContain(
      "Bare `voratiq` launches an interactive session from a git repository root.",
    );
    expect(stdout.join("")).toContain("Current directory:");
    expect(stdout.join("")).toContain("Next steps:");
    expect(stdout.join("")).toContain("git init");
    expect(stdout.join("")).toContain("voratiq");
    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints an explicit repo-root recovery path when bare voratiq is used from a repo subdirectory", async () => {
    shouldStartRootLauncherMock.mockReturnValue(true);
    runInteractiveRootLauncherMock.mockRejectedValue(
      new GitRepositoryError(
        "Run `voratiq` from the repository root.",
        "not_repository_root",
        "/repo",
      ),
    );

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

    await runCli(["node", "voratiq"]);

    expect(stdout.join("")).toContain(
      "Bare `voratiq` launches an interactive session from a repository root.",
    );
    expect(stdout.join("")).toContain("Current directory:");
    expect(stdout.join("")).toContain("Repository root: /repo");
    expect(stdout.join("")).toContain("cd /repo && voratiq");
    expect(stderr.join("")).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });

  it("falls back to existing help output when the launcher is not eligible", async () => {
    shouldStartRootLauncherMock.mockReturnValue(false);

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

    await runCli(["node", "voratiq"]);

    expect(runInteractiveRootLauncherMock).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain(
      "Agent ensembles to design, generate, and select the best code for every task.",
    );
    expect(stderr.join("")).toHaveLength(0);
  });
});
