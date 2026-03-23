import { jest } from "@jest/globals";

import {
  type AutoApplyStageResult,
  type AutoCommandDependencies,
  type AutoRunStageResult,
  type AutoVerifyStageResult,
  executeAutoCommand,
} from "../../../src/commands/auto/command.js";

function createDependencies(
  overrides: Partial<AutoCommandDependencies> = {},
): AutoCommandDependencies {
  const runSpecStage: jest.MockedFunction<
    AutoCommandDependencies["runSpecStage"]
  > = jest.fn();
  const runRunStage: jest.MockedFunction<
    AutoCommandDependencies["runRunStage"]
  > = jest.fn();
  const runVerifyStage: jest.MockedFunction<
    AutoCommandDependencies["runVerifyStage"]
  > = jest.fn();
  const runApplyStage: jest.MockedFunction<
    AutoCommandDependencies["runApplyStage"]
  > = jest.fn();

  return {
    runSpecStage,
    runRunStage,
    runVerifyStage,
    runApplyStage,
    ...overrides,
  };
}

function createRunStageResult(
  overrides: Partial<AutoRunStageResult> = {},
): AutoRunStageResult {
  return {
    body: "run body",
    report: {
      runId: "run-1",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      baseRevisionSha: "deadbeef",
      spec: { path: "specs/task.md" },
      agents: [{ agentId: "alpha" }, { agentId: "beta" }],
    },
    ...overrides,
  };
}

function createVerifyStageResult(
  overrides: Partial<AutoVerifyStageResult> = {},
): AutoVerifyStageResult {
  return {
    verificationId: "verify-1",
    body: "verify body",
    ...overrides,
  };
}

function createApplyStageResult(
  overrides: Partial<AutoApplyStageResult> = {},
): AutoApplyStageResult {
  return {
    body: "apply body",
    exitCode: 0,
    ...overrides,
  };
}

function findEventIndex(
  events: readonly { kind: string }[],
  kind: string,
): number {
  return events.findIndex((event) => event.kind === kind);
}

describe("executeAutoCommand", () => {
  it("returns action required when spec generation produces multiple drafts", async () => {
    const runRunStage = jest.fn<AutoCommandDependencies["runRunStage"]>();
    const dependencies = createDependencies({
      now: () => 0,
      runSpecStage: jest
        .fn<AutoCommandDependencies["runSpecStage"]>()
        .mockResolvedValue({
          sessionId: "spec-session-multi",
          body: "spec body",
          generatedSpecPaths: ["specs/a.md", "specs/b.md"],
        }),
      runRunStage,
    });

    const result = await executeAutoCommand(
      {
        description: "Define the task",
        apply: true,
      },
      dependencies,
    );

    expect(runRunStage).not.toHaveBeenCalled();
    expect(result.auto.status).toBe("action_required");
    expect(result.auto.detail).toBe(
      "Multiple specs generated; manual selection required.",
    );
    expect(result.apply.status).toBe("skipped");
    expect(result.summary.spec.detail).toBe(
      "Multiple specs generated; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail: "Multiple specs generated; manual selection required.",
        message: "Multiple specs generated; manual selection required.",
      }),
    );
  });

  it("auto-applies from unanimous verifier recommendations in the application layer", async () => {
    const onEvent = jest.fn();
    const runApplyStage = jest
      .fn<AutoCommandDependencies["runApplyStage"]>()
      .mockResolvedValue(createApplyStageResult());
    const dependencies = createDependencies({
      now: () => 0,
      onEvent,
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(createRunStageResult()),
      runVerifyStage: jest
        .fn<AutoCommandDependencies["runVerifyStage"]>()
        .mockResolvedValue(
          createVerifyStageResult({
            selection: {
              state: "resolvable",
              applyable: true,
              selectedCanonicalAgentId: "beta",
              unresolvedReasons: [],
            },
          }),
        ),
      runApplyStage,
    });

    const result = await executeAutoCommand(
      {
        specPath: "specs/task.md",
        apply: true,
      },
      dependencies,
    );

    expect(runApplyStage).toHaveBeenCalledWith({
      runId: "run-1",
      agentId: "beta",
      commit: false,
    });
    expect(result.auto.status).toBe("succeeded");
    expect(result.apply.status).toBe("succeeded");
    expect(result.appliedAgentId).toBe("beta");
    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "body", body: "run body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "body", body: "verify body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ kind: "body", body: "apply body" }),
    );
  });

  it("returns action required when verifiers disagree instead of letting the CLI decide", async () => {
    const runApplyStage = jest.fn<AutoCommandDependencies["runApplyStage"]>();
    const dependencies = createDependencies({
      now: () => 0,
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(
          createRunStageResult({
            report: {
              ...createRunStageResult().report,
              runId: "run-2",
            },
          }),
        ),
      runVerifyStage: jest
        .fn<AutoCommandDependencies["runVerifyStage"]>()
        .mockResolvedValue(
          createVerifyStageResult({
            selection: {
              state: "unresolved",
              applyable: false,
              unresolvedReasons: [
                {
                  code: "verifier_disagreement",
                  selections: [
                    {
                      verifierAgentId: "verifier-a",
                      selectedCanonicalAgentId: "alpha",
                    },
                    {
                      verifierAgentId: "verifier-b",
                      selectedCanonicalAgentId: "beta",
                    },
                  ],
                },
              ],
            },
          }),
        ),
      runApplyStage,
    });

    const result = await executeAutoCommand(
      {
        specPath: "specs/task.md",
        apply: true,
      },
      dependencies,
    );

    expect(runApplyStage).not.toHaveBeenCalled();
    expect(result.auto.status).toBe("action_required");
    expect(result.apply.status).toBe("skipped");
    expect(result.auto.detail).toBe(
      "Verifiers disagreed on the preferred candidate; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail:
          "Verifiers disagreed on the preferred candidate; manual selection required.",
        message:
          "Verifiers disagreed on the preferred candidate; manual selection required.",
      }),
    );
    expect(findEventIndex(result.events, "body")).toBeLessThan(
      findEventIndex(result.events, "action_required"),
    );
  });

  it("returns action required when verify(run) is unresolved even without apply", async () => {
    const runApplyStage = jest.fn<AutoCommandDependencies["runApplyStage"]>();
    const dependencies = createDependencies({
      now: () => 0,
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(
          createRunStageResult({
            report: {
              ...createRunStageResult().report,
              runId: "run-3",
            },
          }),
        ),
      runVerifyStage: jest
        .fn<AutoCommandDependencies["runVerifyStage"]>()
        .mockResolvedValue(
          createVerifyStageResult({
            selection: {
              state: "unresolved",
              applyable: false,
              unresolvedReasons: [
                {
                  code: "verifier_disagreement",
                  selections: [
                    {
                      verifierAgentId: "verifier-a",
                      selectedCanonicalAgentId: "alpha",
                    },
                    {
                      verifierAgentId: "verifier-b",
                      selectedCanonicalAgentId: "beta",
                    },
                  ],
                },
              ],
            },
          }),
        ),
      runApplyStage,
    });

    const result = await executeAutoCommand(
      {
        specPath: "specs/task.md",
      },
      dependencies,
    );

    expect(runApplyStage).not.toHaveBeenCalled();
    expect(result.auto.status).toBe("action_required");
    expect(result.apply.status).toBe("skipped");
    expect(result.auto.detail).toBe(
      "Verifiers disagreed on the preferred candidate; manual selection required.",
    );
    expect(result.summary.verify.detail).toBe(
      "Verifiers disagreed on the preferred candidate; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail:
          "Verifiers disagreed on the preferred candidate; manual selection required.",
        message:
          "Verifiers disagreed on the preferred candidate; manual selection required.",
      }),
    );
    expect(findEventIndex(result.events, "body")).toBeLessThan(
      findEventIndex(result.events, "action_required"),
    );
  });

  it("emits the verify transcript body before action required when no programmatic candidates passed", async () => {
    const dependencies = createDependencies({
      now: () => 0,
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(createRunStageResult()),
      runVerifyStage: jest
        .fn<AutoCommandDependencies["runVerifyStage"]>()
        .mockResolvedValue(
          createVerifyStageResult({
            body: "run verify body",
            selection: {
              state: "unresolved",
              applyable: false,
              unresolvedReasons: [
                {
                  code: "no_programmatic_candidates_passed",
                  candidateIds: ["alpha", "beta"],
                },
              ],
            },
          }),
        ),
    });

    const result = await executeAutoCommand(
      {
        specPath: "specs/task.md",
      },
      dependencies,
    );

    expect(result.auto.status).toBe("action_required");
    expect(result.summary.verify.detail).toBe(
      "No run candidate passed programmatic verification; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "body",
        body: "run verify body",
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail:
          "No run candidate passed programmatic verification; manual selection required.",
        message:
          "No run candidate passed programmatic verification; manual selection required.",
      }),
    );
    expect(findEventIndex(result.events, "body")).toBeLessThan(
      findEventIndex(result.events, "action_required"),
    );
  });

  it("emits the spec verification transcript body before the run stage", async () => {
    const onEvent = jest.fn();
    const runVerifyStage = jest
      .fn<AutoCommandDependencies["runVerifyStage"]>()
      .mockImplementation((input) =>
        Promise.resolve(
          input.target.kind === "spec"
            ? createVerifyStageResult({
                body: "spec verify body",
                selectedSpecPath: "specs/selected.md",
              })
            : createVerifyStageResult({
                body: "run verify body",
              }),
        ),
      );
    const dependencies = createDependencies({
      now: () => 0,
      onEvent,
      runSpecStage: jest
        .fn<AutoCommandDependencies["runSpecStage"]>()
        .mockResolvedValue({
          body: "spec body",
          sessionId: "spec-session-1",
          generatedSpecPaths: ["specs/generated.md"],
          specPath: "specs/generated.md",
        }),
      runRunStage: jest
        .fn<AutoCommandDependencies["runRunStage"]>()
        .mockResolvedValue(
          createRunStageResult({
            report: {
              ...createRunStageResult().report,
              spec: { path: "specs/selected.md" },
            },
            body: "run body",
          }),
        ),
      runVerifyStage,
    });

    const result = await executeAutoCommand(
      {
        description: "Define the task",
      },
      dependencies,
    );

    expect(result.auto.status).toBe("succeeded");
    expect(runVerifyStage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        target: { kind: "spec", sessionId: "spec-session-1" },
      }),
    );
    expect(runVerifyStage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: { kind: "run", sessionId: "run-1" },
      }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "body", body: "spec body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "body", body: "spec verify body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ kind: "body", body: "run body" }),
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ kind: "body", body: "run verify body" }),
    );
  });
});
