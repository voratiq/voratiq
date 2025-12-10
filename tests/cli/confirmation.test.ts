import { describe, expect, it, jest } from "@jest/globals";

import { createConfirmationWorkflow } from "../../src/cli/confirmation.js";

describe("createConfirmationWorkflow", () => {
  it("throws via onUnavailable when shell is non-interactive without --yes", () => {
    expect(() =>
      createConfirmationWorkflow({
        detectInteractive: () => false,
        onUnavailable: () => {
          throw new Error("interactive required");
        },
      }),
    ).toThrow("interactive required");
  });

  it("creates an interactor when assumeYes is set", async () => {
    const confirm = jest.fn(() => Promise.resolve(true));
    const prompt = jest.fn(() => Promise.resolve("value"));
    const close = jest.fn();

    const workflow = createConfirmationWorkflow({
      assumeYes: true,
      detectInteractive: () => false,
      onUnavailable: () => {
        throw new Error("should not run");
      },
      createInteractor: () => ({ confirm, prompt, close }),
    });

    expect(workflow.interactive).toBe(false);
    await workflow.confirm({ message: "Continue?", defaultValue: false });
    await workflow.prompt({ message: "Name" });
    workflow.close();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports interactive shells without forcing --yes", () => {
    const workflow = createConfirmationWorkflow({
      detectInteractive: () => true,
      onUnavailable: () => {
        throw new Error("should not run");
      },
      createInteractor: () => ({
        confirm: jest.fn(() => Promise.resolve(true)),
        prompt: jest.fn(() => Promise.resolve("")),
        close: jest.fn(),
      }),
    });

    expect(workflow.interactive).toBe(true);
  });
});
