import {
  deriveRunStatusFromAgents,
  mapRunStatusToExitCode,
} from "../../src/status/index.js";

describe("run status semantics", () => {
  it("marks the run succeeded when at least one agent succeeds", () => {
    const status = deriveRunStatusFromAgents([
      "failed",
      "succeeded",
      "errored",
    ]);
    expect(status).toBe("succeeded");
  });

  it("marks the run failed when no agents succeed", () => {
    expect(deriveRunStatusFromAgents(["failed", "errored", "skipped"])).toBe(
      "failed",
    );
    expect(deriveRunStatusFromAgents([])).toBe("failed");
  });

  it("maps terminal run statuses to deterministic exit codes", () => {
    expect(mapRunStatusToExitCode("succeeded")).toBe(0);
    expect(mapRunStatusToExitCode("failed")).toBe(1);
    expect(mapRunStatusToExitCode("errored")).toBe(2);
    expect(mapRunStatusToExitCode("aborted")).toBe(3);
  });

  it("rejects non-terminal run statuses when mapping exit codes", () => {
    expect(() => mapRunStatusToExitCode("running" as never)).toThrow(
      /non-terminal run status/u,
    );
  });
});
