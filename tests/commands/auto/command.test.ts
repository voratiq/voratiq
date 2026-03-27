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
  it("continues through spec verification when spec generation produces multiple drafts", async () => {
    const runRunStage = jest
      .fn<AutoCommandDependencies["runRunStage"]>()
      .mockResolvedValue(
        createRunStageResult({
          report: {
            ...createRunStageResult().report,
            spec: { path: "specs/b.md" },
          },
        }),
      );
    const runVerifyStage = jest
      .fn<AutoCommandDependencies["runVerifyStage"]>()
      .mockImplementation((input) =>
        Promise.resolve(
          input.target.kind === "spec"
            ? createVerifyStageResult({
                body: "spec verify body",
                selectedSpecPath: "specs/b.md",
              })
            : createVerifyStageResult({
                body: "run verify body",
              }),
        ),
      );
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
      runVerifyStage,
    });

    const result = await executeAutoCommand(
      {
        description: "Define the task",
      },
      dependencies,
    );

    expect(runVerifyStage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        target: { kind: "spec", sessionId: "spec-session-multi" },
      }),
    );
    expect(runRunStage).toHaveBeenCalledWith(
      expect.objectContaining({
        specPath: "specs/b.md",
      }),
    );
    expect(result.auto.status).toBe("succeeded");
    expect(result.apply.status).toBe("skipped");
    expect(result.summary.spec.detail).toBeUndefined();
    expect(result.events).not.toContainEqual(
      expect.objectContaining({
        kind: "action_required",
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

  it("returns action required when verify(spec) is unresolved", async () => {
    const runRunStage = jest.fn<AutoCommandDependencies["runRunStage"]>();
    const runVerifyStage = jest
      .fn<AutoCommandDependencies["runVerifyStage"]>()
      .mockResolvedValueOnce(
        createVerifyStageResult({
          body: "spec verify body",
          selection: {
            state: "unresolved",
            applyable: false,
            unresolvedReasons: [
              {
                code: "verifier_disagreement",
                selections: [
                  {
                    verifierAgentId: "reviewer-a",
                    selectedCanonicalAgentId: "specs/a.md",
                  },
                  {
                    verifierAgentId: "reviewer-b",
                    selectedCanonicalAgentId: "specs/b.md",
                  },
                ],
              },
            ],
          },
        }),
      );
    const dependencies = createDependencies({
      now: () => 0,
      runSpecStage: jest
        .fn<AutoCommandDependencies["runSpecStage"]>()
        .mockResolvedValue({
          sessionId: "spec-session-unresolved",
          body: "spec body",
          generatedSpecPaths: ["specs/a.md", "specs/b.md"],
        }),
      runRunStage,
      runVerifyStage,
    });

    const result = await executeAutoCommand(
      {
        description: "Define the task",
      },
      dependencies,
    );

    expect(runRunStage).not.toHaveBeenCalled();
    expect(result.auto.status).toBe("action_required");
    expect(result.apply.status).toBe("skipped");
    expect(result.auto.detail).toBe(
      "Spec verifiers disagreed on the preferred draft; manual selection required.",
    );
    expect(result.summary.spec.detail).toBe(
      "Spec verifiers disagreed on the preferred draft; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail:
          "Spec verifiers disagreed on the preferred draft; manual selection required.",
        message:
          "Spec verifiers disagreed on the preferred draft; manual selection required.",
      }),
    );
    expect(findEventIndex(result.events, "body")).toBeLessThan(
      findEventIndex(result.events, "action_required"),
    );
  });

  it("fails when verify(spec) returns a resolvable selection without a selected spec path", async () => {
    const runRunStage = jest.fn<AutoCommandDependencies["runRunStage"]>();
    const runVerifyStage = jest
      .fn<AutoCommandDependencies["runVerifyStage"]>()
      .mockResolvedValueOnce(
        createVerifyStageResult({
          body: "spec verify body",
          selection: {
            state: "resolvable",
            applyable: true,
            selectedCanonicalAgentId: "specs/b.md",
            unresolvedReasons: [],
          },
        }),
      );
    const dependencies = createDependencies({
      now: () => 0,
      runSpecStage: jest
        .fn<AutoCommandDependencies["runSpecStage"]>()
        .mockResolvedValue({
          sessionId: "spec-session-resolvable-without-path",
          body: "spec body",
          generatedSpecPaths: ["specs/a.md", "specs/b.md"],
        }),
      runRunStage,
      runVerifyStage,
    });

    const result = await executeAutoCommand(
      {
        description: "Define the task",
      },
      dependencies,
    );

    expect(runRunStage).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(result.auto.status).toBe("failed");
    expect(result.auto.detail).toBe(
      "Spec verification returned a resolvable selection without a selected spec path.",
    );
    expect(result.summary.spec.detail).toBe(
      "Spec verification returned a resolvable selection without a selected spec path.",
    );
    expect(result.events).not.toContainEqual(
      expect.objectContaining({
        kind: "action_required",
      }),
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

  it("uses the generic unresolved fallback for verify(run)", async () => {
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
                  code: "selector_unresolved",
                  selector: "none",
                  availableCanonicalAgentIds: ["alpha", "beta"],
                  availableAliases: [],
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
      "Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "action_required",
        detail:
          "Verification did not produce a resolvable candidate; manual selection required.",
        message:
          "Verification did not produce a resolvable candidate; manual selection required.",
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
