import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { resolveVerificationAgents } from "../../../src/commands/verify/agents.js";
import { executeVerifyCommand } from "../../../src/commands/verify/command.js";
import { clearActiveVerification } from "../../../src/commands/verify/lifecycle.js";
import { resolveVerifyTarget } from "../../../src/commands/verify/targets.js";
import { loadVerificationConfig } from "../../../src/configs/verification/loader.js";
import { executeAndPersistProgrammaticMethod } from "../../../src/domain/verify/competition/programmatic.js";
import { executeAndPersistRubricMethods } from "../../../src/domain/verify/competition/rubric.js";
import { flushAllVerificationRecordBuffers } from "../../../src/domain/verify/persistence/adapter.js";
import { loadOperatorEnvironment } from "../../../src/preflight/environment.js";
import { prepareConfiguredOperatorReadiness } from "../../../src/preflight/operator.js";
import { emitSwarmSessionAcknowledgement } from "../../../src/utils/swarm-session-ack.js";

jest.mock("../../../src/commands/verify/agents.js", () => ({
  resolveVerificationAgents: jest.fn(),
}));

jest.mock("../../../src/commands/verify/targets.js", () => ({
  resolveVerifyTarget: jest.fn(),
}));

jest.mock("../../../src/configs/verification/loader.js", () => ({
  loadVerificationConfig: jest.fn(),
}));

jest.mock("../../../src/domain/verify/competition/programmatic.js", () => ({
  executeAndPersistProgrammaticMethod: jest.fn(),
}));

jest.mock("../../../src/domain/verify/competition/rubric.js", () => ({
  executeAndPersistRubricMethods: jest.fn(),
}));

jest.mock("../../../src/preflight/environment.js", () => ({
  loadOperatorEnvironment: jest.fn(),
}));

jest.mock("../../../src/preflight/operator.js", () => ({
  prepareConfiguredOperatorReadiness: jest.fn(),
}));

jest.mock("../../../src/commands/shared/session-id.js", () => ({
  generateSessionId: jest.fn(),
}));

jest.mock("../../../src/utils/swarm-session-ack.js", () => ({
  emitSwarmSessionAcknowledgement: jest.fn(),
}));

const resolveVerificationAgentsMock = jest.mocked(resolveVerificationAgents);
const resolveVerifyTargetMock = jest.mocked(resolveVerifyTarget);
const loadVerificationConfigMock = jest.mocked(loadVerificationConfig);
const executeAndPersistProgrammaticMethodMock = jest.mocked(
  executeAndPersistProgrammaticMethod,
);
const executeAndPersistRubricMethodsMock = jest.mocked(
  executeAndPersistRubricMethods,
);
const loadOperatorEnvironmentMock = jest.mocked(loadOperatorEnvironment);
const prepareConfiguredOperatorReadinessMock = jest.mocked(
  prepareConfiguredOperatorReadiness,
);
const generateSessionIdMock = jest.mocked(generateSessionId);
const emitSwarmSessionAcknowledgementMock = jest.mocked(
  emitSwarmSessionAcknowledgement,
);

describe("verify startup ordering", () => {
  let root: string;
  let verificationsFilePath: string;

  beforeEach(async () => {
    jest.clearAllMocks();

    root = await mkdtemp(join(tmpdir(), "voratiq-verify-startup-"));
    verificationsFilePath = join(root, ".voratiq", "verify", "index.json");
    await mkdir(join(root, ".voratiq", "verify"), { recursive: true });

    generateSessionIdMock.mockReturnValue("verify-startup");
    resolveVerifyTargetMock.mockResolvedValue({
      baseRevisionSha: "base-sha",
      competitiveCandidates: [],
      target: {
        kind: "run",
        sessionId: "run-123",
        candidateIds: ["agent-a"],
      },
      runRecord: {
        runId: "run-123",
        status: "succeeded",
        baseRevisionSha: "base-sha",
        agents: [],
      },
    } as never);
    loadVerificationConfigMock.mockReturnValue({
      spec: { rubric: [] },
      run: { programmatic: [], rubric: [] },
      reduce: { rubric: [] },
      message: { rubric: [] },
    });
    resolveVerificationAgentsMock.mockReturnValue({
      agentIds: ["verifier-a"],
      competitors: [],
    });
    prepareConfiguredOperatorReadinessMock.mockResolvedValue({
      agents: [
        {
          id: "verifier-a",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: ["node"],
        },
      ],
      issues: [],
      preProviderIssueCount: 0,
      noAgentsEnabled: false,
    });
    loadOperatorEnvironmentMock.mockReturnValue({});
    executeAndPersistProgrammaticMethodMock.mockResolvedValue(undefined);
    executeAndPersistRubricMethodsMock.mockResolvedValue([]);
    emitSwarmSessionAcknowledgementMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    clearActiveVerification("verify-startup");
    await flushAllVerificationRecordBuffers();
    await rm(root, { recursive: true, force: true });
  });

  it("does not let the live renderer present running before the persisted record says running", async () => {
    const rendererEvents: string[] = [];
    const sessionRecordPath = join(
      root,
      ".voratiq",
      "verify",
      "sessions",
      "verify-startup",
      "record.json",
    );

    const result = await executeVerifyCommand({
      root,
      specsFilePath: join(root, ".voratiq", "spec", "index.json"),
      runsFilePath: join(root, ".voratiq", "run", "index.json"),
      reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
      messagesFilePath: join(root, ".voratiq", "message", "index.json"),
      verificationsFilePath,
      target: { kind: "run", sessionId: "run-123" },
      renderer: {
        onProgressEvent: () => {},
        begin: (context) => {
          rendererEvents.push(`begin:${context?.status ?? "missing"}`);

          const persistedRecord = JSON.parse(
            readFileSync(sessionRecordPath, "utf8"),
          ) as { status: string; startedAt?: string };
          const persistedIndex = JSON.parse(
            readFileSync(verificationsFilePath, "utf8"),
          ) as {
            sessions: Array<{ sessionId: string; status: string }>;
          };

          expect(persistedRecord.status).toBe("running");
          expect(persistedRecord.startedAt).toBe(context?.startedAt);
          expect(
            persistedIndex.sessions.find(
              (session) => session.sessionId === "verify-startup",
            )?.status,
          ).toBe("running");
        },
        update: () => {},
        complete: (status) => {
          rendererEvents.push(`complete:${status ?? "missing"}`);
        },
      },
    });

    expect(result.verificationId).toBe("verify-startup");
    expect(result.record.status).toBe("succeeded");
    expect(rendererEvents).toEqual(["begin:running", "complete:succeeded"]);
  });
});
