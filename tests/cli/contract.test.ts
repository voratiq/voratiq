import {
  externalAdapterContractReference,
  externalExecutionInputSchemas,
  externalExecutionOperators,
  externalInspectionInputSchemas,
  externalInspectionOperators,
} from "../../src/cli/contract.js";

describe("external adapter contract definitions", () => {
  it("enumerates the declared execution and inspection surfaces", () => {
    expect(externalExecutionOperators).toEqual([
      "spec",
      "run",
      "reduce",
      "verify",
      "message",
      "apply",
    ]);
    expect(externalInspectionOperators).toEqual([
      "spec",
      "run",
      "reduce",
      "verify",
      "message",
      "interactive",
    ]);
    expect(externalAdapterContractReference.excludedCommands).toEqual([
      "auto",
      "doctor",
    ]);
  });

  it("defines strict execution schemas for every declared operator", () => {
    expect(
      externalExecutionInputSchemas.spec.safeParse({
        description: "Build the task",
        unexpected: true,
      }).success,
    ).toBe(false);

    expect(
      externalExecutionInputSchemas.run.safeParse({
        specPath: "specs/task.md",
        branch: true,
      }).success,
    ).toBe(true);

    expect(
      externalExecutionInputSchemas.message.safeParse({
        prompt: "Reply with status",
        profile: "default",
      }).success,
    ).toBe(true);

    expect(
      externalExecutionInputSchemas.reduce.safeParse({
        target: {
          type: "message",
          id: "message-123",
        },
      }).success,
    ).toBe(true);

    expect(
      externalExecutionInputSchemas.verify.safeParse({
        target: {
          kind: "run",
          sessionId: "run-123",
        },
      }).success,
    ).toBe(true);

    expect(
      externalExecutionInputSchemas.verify.safeParse({
        target: {
          kind: "message",
          sessionId: "message-123",
        },
      }).success,
    ).toBe(true);
  });

  it("defines table and detail list inspection schemas", () => {
    expect(
      externalInspectionInputSchemas.list.table.safeParse({
        operator: "run",
        mode: "table",
        limit: 10,
        verbose: true,
      }).success,
    ).toBe(true);

    expect(
      externalInspectionInputSchemas.list.detail.safeParse({
        operator: "interactive",
        mode: "detail",
        sessionId: "interactive-123",
      }).success,
    ).toBe(true);

    expect(
      externalInspectionInputSchemas.list.detail.safeParse({
        operator: "verify",
        mode: "detail",
        sessionId: "verify-123",
      }).success,
    ).toBe(true);

    expect(
      externalInspectionInputSchemas.list.union.safeParse({
        operator: "verify",
        mode: "detail",
      }).success,
    ).toBe(false);
  });
});
