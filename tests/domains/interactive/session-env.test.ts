import { getInteractiveSessionRecordSnapshot } from "../../../src/domain/interactive/persistence/adapter.js";
import { resolveInteractiveSessionEnvLineage } from "../../../src/domain/interactive/session-env.js";

jest.mock("../../../src/domain/interactive/persistence/adapter.js", () => ({
  getInteractiveSessionRecordSnapshot: jest.fn(),
}));

const getSnapshotMock = jest.mocked(getInteractiveSessionRecordSnapshot);

describe("resolveInteractiveSessionEnvLineage", () => {
  beforeEach(() => {
    getSnapshotMock.mockReset();
  });

  it("returns ignore when the env value is undefined", async () => {
    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: undefined,
    });

    expect(result).toEqual({ kind: "ignore" });
    expect(getSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns ignore when the env value is empty or whitespace", async () => {
    const blank = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "",
    });
    const whitespace = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "   ",
    });

    expect(blank).toEqual({ kind: "ignore" });
    expect(whitespace).toEqual({ kind: "ignore" });
    expect(getSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns trusted when the referenced session is running", async () => {
    getSnapshotMock.mockResolvedValueOnce({
      sessionId: "interactive-live",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "running",
      agentId: "agent-a",
      toolAttachmentStatus: "attached",
    });

    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "interactive-live",
    });

    expect(result).toEqual({
      kind: "trusted",
      sessionId: "interactive-live",
    });
    expect(getSnapshotMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: "interactive-live",
    });
  });

  it("returns ignore when the referenced session has already succeeded", async () => {
    getSnapshotMock.mockResolvedValueOnce({
      sessionId: "interactive-done",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "succeeded",
      agentId: "agent-a",
      toolAttachmentStatus: "attached",
    });

    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "interactive-done",
    });

    expect(result).toEqual({ kind: "ignore" });
  });

  it("returns ignore when the referenced session has failed", async () => {
    getSnapshotMock.mockResolvedValueOnce({
      sessionId: "interactive-broken",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "failed",
      agentId: "agent-a",
      toolAttachmentStatus: "failed",
    });

    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "interactive-broken",
    });

    expect(result).toEqual({ kind: "ignore" });
  });

  it("returns ignore when no record exists for the env session id", async () => {
    getSnapshotMock.mockResolvedValueOnce(undefined);

    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "interactive-missing",
    });

    expect(result).toEqual({ kind: "ignore" });
  });

  it("returns ignore when the persistence adapter throws", async () => {
    getSnapshotMock.mockRejectedValueOnce(new Error("disk exploded"));

    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "interactive-error",
    });

    expect(result).toEqual({ kind: "ignore" });
  });

  it("trims whitespace from env values before lookup", async () => {
    getSnapshotMock.mockResolvedValueOnce({
      sessionId: "interactive-trim",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "running",
      agentId: "agent-a",
      toolAttachmentStatus: "attached",
    });

    const result = await resolveInteractiveSessionEnvLineage({
      root: "/repo",
      envValue: "  interactive-trim  ",
    });

    expect(result).toEqual({
      kind: "trusted",
      sessionId: "interactive-trim",
    });
    expect(getSnapshotMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: "interactive-trim",
    });
  });
});
