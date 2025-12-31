import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import * as harness from "../../src/agents/runtime/harness.js";
import * as sandboxRuntime from "../../src/agents/runtime/sandbox.js";
import { CliError, NonInteractiveShellError } from "../../src/cli/errors.js";
import { runSpecCommand } from "../../src/cli/spec.js";
import { executeSpecCommand } from "../../src/commands/spec/command.js";
import { buildDraftPreviewLines } from "../../src/commands/spec/preview.js";
import * as preflight from "../../src/preflight/index.js";
import { renderCliError } from "../../src/render/utils/errors.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import {
  createRunTestWorkspace,
  type RunTestWorkspace,
} from "../support/fixtures/run-workspace.js";

const runSandboxedAgentMock = jest.mocked(harness.runSandboxedAgent);

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

jest.mock("../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

describe("voratiq spec (CLI)", () => {
  let repoRoot: string;
  let originalCwd: string;
  let workspace: RunTestWorkspace;
  let restorePlatformSpy: jest.SpyInstance | undefined;
  let restoreDependenciesSpy: jest.SpyInstance | undefined;

  beforeEach(async () => {
    workspace = await createRunTestWorkspace();
    repoRoot = workspace.root;
    originalCwd = process.cwd();
    process.chdir(repoRoot);
    await createWorkspace(repoRoot);
    await workspace.writeAgentsConfig([
      {
        id: "claude-haiku-4-5-20251001",
        model: "claude-haiku-4-5-20251001",
        binary: workspace.srtStubPath,
        provider: "claude",
        enabled: true,
      },
    ]);

    restorePlatformSpy = jest
      .spyOn(sandboxRuntime, "checkPlatformSupport")
      .mockImplementation(() => {});
    restoreDependenciesSpy = jest
      .spyOn(preflight, "ensureSandboxDependencies")
      .mockImplementation(() => {});

    runSandboxedAgentMock.mockReset();
    runSandboxedAgentMock.mockImplementation(async (options) => {
      const draftPath = join(options.paths.workspacePath, "spec.md");
      await mkdir(dirname(draftPath), { recursive: true });
      await writeFile(draftPath, "# Payment Flow\n\nDetails.\n", "utf8");
      return {
        exitCode: 0,
        sandboxSettings: {
          network: {
            allowedDomains: [],
            deniedDomains: [],
          },
          filesystem: {
            denyRead: [],
            allowWrite: [],
            denyWrite: [],
          },
        },
        manifestEnv: {},
      };
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    restorePlatformSpy?.mockRestore();
    restoreDependenciesSpy?.mockRestore();
    await workspace?.cleanup();
  });

  it("requires --yes in non-interactive shells", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(
      runSpecCommand({
        description: "Write a spec",
        agent: "claude-haiku-4-5-20251001",
      }),
    ).rejects.toBeInstanceOf(NonInteractiveShellError);

    if (originalDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
    }
  });

  it("formats invalid agent errors with the desired copy", async () => {
    let captured: unknown;
    await expect(
      runSpecCommand({
        description: "Do something",
        agent: "missing",
        yes: true,
      }).catch((error) => {
        captured = error;
        throw error;
      }),
    ).rejects.toBeDefined();

    const rendered = renderCliError(captured as CliError).replace(
      ANSI_PATTERN,
      "",
    );
    expect(rendered).toBe(
      [
        'Error: Agent "missing" not found in agents.yaml.',
        "",
        "To add this agent, edit `.voratiq/agents.yaml`.",
      ].join("\n"),
    );
  });

  it("rejects output paths outside .voratiq/specs", async () => {
    await expect(
      runSpecCommand({
        description: "Spec with bad path",
        agent: "claude-haiku-4-5-20251001",
        output: "../escape.md",
        yes: true,
      }),
    ).rejects.toThrow(".voratiq/specs");
  });

  it("aborts when the target output already exists", async () => {
    const existingPath = join(repoRoot, ".voratiq", "specs", "custom.md");
    await mkdir(dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "existing", "utf8");

    await expect(
      runSpecCommand({
        description: "Design a payment flow",
        agent: "claude-haiku-4-5-20251001",
        title: "Payment Flow",
        output: ".voratiq/specs/custom.md",
        yes: true,
      }),
    ).rejects.toThrow("File already exists");
  });

  it("promotes draft artifacts, updates records, and writes canonical output", async () => {
    const title = "Payment Flow";

    await runSpecCommand({
      description: "Design a payment flow",
      agent: "claude-haiku-4-5-20251001",
      title,
      yes: true,
    });

    const indexPath = join(repoRoot, ".voratiq", "specs", "index.json");
    const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
      sessions: Array<{ sessionId: string; status: string }>;
    };
    const latest = indexPayload.sessions.at(-1);
    expect(latest).toBeDefined();
    const sessionId = latest?.sessionId ?? "";
    expect(latest?.status).toBe("saved");

    const recordPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "record.json",
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      slug: string;
      outputPath: string;
      iterations: Array<{ accepted: boolean }>;
      agentId: string;
    };

    expect(record.slug).toBe("payment-flow");
    expect(record.outputPath).toBe(".voratiq/specs/payment-flow.md");
    expect(record.agentId).toBe("claude-haiku-4-5-20251001");
    expect(record.iterations).toHaveLength(1);
    expect(record.iterations[0]?.accepted).toBe(true);

    const draftPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "sessions",
      sessionId,
      "claude-haiku-4-5-20251001",
      "artifacts",
      "drafts",
      "01",
      "spec.md",
    );
    const canonicalPath = join(
      repoRoot,
      ".voratiq",
      "specs",
      "payment-flow.md",
    );

    await expect(readFile(draftPath, "utf8")).resolves.toContain(
      "# Payment Flow",
    );
    await expect(readFile(canonicalPath, "utf8")).resolves.toContain(
      "# Payment Flow",
    );
  });

  it("shows the draft preview before confirmation and reuses it for feedback", async () => {
    const confirmations: Array<{ message: string; prefaceLines?: string[] }> =
      [];
    const prompts: Array<{ message: string; prefaceLines?: string[] }> = [];

    let iteration = 0;
    runSandboxedAgentMock.mockImplementation(async (options) => {
      const draftPath = join(options.paths.workspacePath, "spec.md");
      await mkdir(dirname(draftPath), { recursive: true });
      await writeFile(
        draftPath,
        iteration === 0
          ? "# Draft\nDetails\nLine2\n"
          : "# Draft refined\nBetter\n",
        "utf8",
      );
      iteration += 1;
      return {
        exitCode: 0,
        sandboxSettings: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
        },
        manifestEnv: {},
      };
    });

    await executeSpecCommand({
      root: repoRoot,
      specsFilePath: join(repoRoot, ".voratiq", "specs", "index.json"),
      description: "Design a payment flow",
      agentId: "claude-haiku-4-5-20251001",
      title: "Payment Flow",
      outputPath: undefined,
      assumeYes: false,
      interactive: true,
      confirm: async (options) => {
        confirmations.push(options);
        await Promise.resolve();
        return confirmations.length === 2; // decline first, accept second
      },
      prompt: async (options) => {
        prompts.push(options);
        await Promise.resolve();
        return "Add more detail";
      },
    });

    const firstPreview = buildDraftPreviewLines("# Draft\nDetails\nLine2\n");
    expect(confirmations[0]?.prefaceLines).toEqual(firstPreview);
    expect(confirmations[0]?.message).toBe("Save this specification?");
    expect(prompts[0]?.message).toBe(">");
    expect(prompts[0]?.prefaceLines).toEqual([
      "",
      "What would you like to change?",
    ]);
    expect(iteration).toBe(2);
  });
});
