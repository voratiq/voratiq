import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeInitCommand } from "../../../src/commands/init/command.js";
import type { InitPromptHandler } from "../../../src/commands/init/types.js";
import { renderInitTranscript } from "../../../src/render/transcripts/init.js";

jest.mock("node:child_process", () => {
  const actual =
    jest.requireActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawnSync: jest.fn(),
  };
});

describe("init transcript ordering", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-init-transcript-"));
    mockDetectedBinaries({
      claude: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
      gemini: "/usr/local/bin/gemini",
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    (spawnSync as jest.MockedFunction<typeof spawnSync>).mockReset();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("keeps interactive init sections in the expected order", async () => {
    const captured: string[] = ["Initializing Voratiq…"];

    const prompt: InitPromptHandler = (options) => {
      captured.push(...(options.prefaceLines ?? []));
      captured.push("[1]: 2");
      return Promise.resolve("2");
    };

    const result = await executeInitCommand({
      root: repoRoot,
      preset: "pro",
      interactive: true,
      prompt,
    });

    captured.push(...renderInitTranscript(result).split("\n"));

    expect(findIndex(captured, "Initializing Voratiq…")).toBeLessThan(
      findIndex(captured, "Which workspace preset would you like?"),
    );
    expect(
      findIndex(captured, "Which workspace preset would you like?"),
    ).toBeLessThan(findIndex(captured, "Configuring workspace…"));
    expect(findIndex(captured, "Configuring workspace…")).toBeLessThan(
      findIndex(captured, "CONFIGURATION  FILE"),
    );
    expect(findIndex(captured, "CONFIGURATION  FILE")).toBeLessThan(
      findIndex(captured, "To learn more about configuration:"),
    );
    expect(
      findIndex(captured, "agents         .voratiq/agents.yaml"),
    ).toBeLessThan(
      findIndex(captured, "orchestration  .voratiq/orchestration.yaml"),
    );
    expect(
      findIndex(captured, "orchestration  .voratiq/orchestration.yaml"),
    ).toBeLessThan(
      findIndex(captured, "environment    .voratiq/environment.yaml"),
    );
    expect(
      findIndex(captured, "environment    .voratiq/environment.yaml"),
    ).toBeLessThan(findIndex(captured, "evals          .voratiq/evals.yaml"));
    expect(
      findIndex(captured, "evals          .voratiq/evals.yaml"),
    ).toBeLessThan(findIndex(captured, "sandbox        .voratiq/sandbox.yaml"));
    expect(
      findIndex(captured, "To learn more about configuration:"),
    ).toBeLessThan(findIndex(captured, "Voratiq initialized."));
    expect(findIndex(captured, "Voratiq initialized.")).toBeLessThan(
      findIndex(captured, "To generate a spec:"),
    );
    expect(captured.join("\n")).not.toContain("Detecting agent CLIs…");
    expect(captured.join("\n")).not.toContain("PROVIDER  BINARY");
    expect(captured.join("\n")).not.toContain("Enable detected providers?");
  });

  it("keeps non-interactive init sections in the expected order", async () => {
    const result = await executeInitCommand({
      root: repoRoot,
      preset: "lite",
      interactive: false,
    });
    const lines = renderInitTranscript(result).split("\n");

    expect(findIndex(lines, "Configuring workspace…")).toBeLessThan(
      findIndex(lines, "CONFIGURATION  FILE"),
    );
    expect(findIndex(lines, "CONFIGURATION  FILE")).toBeLessThan(
      findIndex(lines, "To learn more about configuration:"),
    );
    expect(
      findIndex(lines, "agents         .voratiq/agents.yaml"),
    ).toBeLessThan(
      findIndex(lines, "orchestration  .voratiq/orchestration.yaml"),
    );
    expect(
      findIndex(lines, "orchestration  .voratiq/orchestration.yaml"),
    ).toBeLessThan(
      findIndex(lines, "environment    .voratiq/environment.yaml"),
    );
    expect(
      findIndex(lines, "environment    .voratiq/environment.yaml"),
    ).toBeLessThan(findIndex(lines, "evals          .voratiq/evals.yaml"));
    expect(findIndex(lines, "evals          .voratiq/evals.yaml")).toBeLessThan(
      findIndex(lines, "sandbox        .voratiq/sandbox.yaml"),
    );
    expect(findIndex(lines, "To learn more about configuration:")).toBeLessThan(
      findIndex(lines, "Voratiq initialized."),
    );
    expect(findIndex(lines, "Voratiq initialized.")).toBeLessThan(
      findIndex(lines, "To generate a spec:"),
    );
    expect(lines.join("\n")).not.toContain("Detecting agent CLIs…");
    expect(lines.join("\n")).not.toContain("PROVIDER  BINARY");
    expect(lines.join("\n")).not.toContain("Enable detected providers?");
  });
});

function findIndex(lines: readonly string[], value: string): number {
  const index = lines.findIndex((line) => line.includes(value));
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function mockDetectedBinaries(binaries: Record<string, string>): void {
  (spawnSync as jest.MockedFunction<typeof spawnSync>).mockImplementation(
    (command, args) => {
      if (command !== "bash" || !Array.isArray(args)) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      const expression = String(args.at(-1));
      const match = /command -v (\w+)/.exec(expression);
      if (!match) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      const binaryPath = binaries[match[1]];
      if (!binaryPath) {
        return {
          status: 1,
          stdout: "",
          stderr: "",
        } as SpawnSyncReturns<string>;
      }

      return {
        status: 0,
        stdout: `${binaryPath}\n`,
        stderr: "",
        pid: 0,
        signal: null,
        output: ["", `${binaryPath}\n`, ""],
      } as SpawnSyncReturns<string>;
    },
  );
}
