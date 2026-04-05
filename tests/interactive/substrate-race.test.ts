import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import {
  prepareNativeInteractiveSession,
  spawnPreparedInteractiveSession,
} from "../../src/interactive/substrate.js";

jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock("../../src/agents/launch/chat.js", () => ({
  collectProviderArtifacts: jest.fn(() => Promise.resolve({ captured: false })),
  prepareProviderArtifactCaptureContext: jest.fn(() =>
    Promise.resolve(undefined),
  ),
}));

const spawnMock = jest.mocked(spawn);
const execFileMock = jest.mocked(execFile);
const tempRoots: string[] = [];

type MockChild = EventEmitter &
  Pick<
    ChildProcess,
    "pid" | "kill" | "exitCode" | "signalCode" | "once" | "emit"
  >;

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  Object.defineProperties(child, {
    pid: { value: 4321, writable: true, configurable: true },
    exitCode: { value: null, writable: true, configurable: true },
    signalCode: { value: null, writable: true, configurable: true },
  });
  child.kill = jest.fn(() => true);
  return child;
}

beforeEach(() => {
  jest.clearAllMocks();
  execFileMock.mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      (
        callback as (
          error: Error | null,
          stdout: string,
          stderr: string,
        ) => void
      )(null, "", "");
    }
    return {} as ReturnType<typeof execFile>;
  }) as typeof execFile);
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("interactive substrate spawn race", () => {
  it("finalizes a session when the child exits in the same tick as spawn", async () => {
    const fixture = await createWorkspaceFixture();
    const child = createMockChild();

    spawnMock.mockImplementation((() => {
      process.nextTick(() => {
        child.emit("spawn");
        (child as { exitCode: number | null }).exitCode = 0;
        child.emit("exit", 0, null);
      });
      return child as unknown as ChildProcess;
    }) as typeof spawn);

    const prepared = await prepareNativeInteractiveSession({
      root: fixture.root,
      agentId: "codex-test",
      sessionId: "20260405-000001-race1",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    const launched = await spawnPreparedInteractiveSession(prepared.prepared, {
      stdio: "ignore",
    });
    expect(launched.ok).toBe(true);
    if (!launched.ok) {
      return;
    }

    const completed = await launched.completion;
    expect(completed.status).toBe("succeeded");

    const storedRecord = await readJson(prepared.prepared.recordPath);
    expect(storedRecord).toMatchObject({
      sessionId: "20260405-000001-race1",
      status: "succeeded",
    });

    const storedIndex = await readJson<{
      sessions: Array<{ sessionId: string; status: string }>;
    }>(prepared.prepared.indexPath);
    expect(storedIndex.sessions).toEqual([
      expect.objectContaining({
        sessionId: "20260405-000001-race1",
        status: "succeeded",
      }),
    ]);
  });
});

async function createWorkspaceFixture(): Promise<{
  root: string;
  binaryPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-interactive-race-"));
  tempRoots.push(root);

  const voratiqDir = join(root, ".voratiq");
  const agentsPath = join(voratiqDir, "agents.yaml");
  const binaryPath = join(root, "bin", "mock-codex.sh");

  await mkdir(voratiqDir, { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(binaryPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(binaryPath, 0o755);

  await writeFile(
    agentsPath,
    `agents:\n  - id: codex-test\n    provider: codex\n    model: gpt-5.4\n    binary: ${binaryPath}\n`,
    "utf8",
  );

  return { root, binaryPath };
}

async function readJson<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}
