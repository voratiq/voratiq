import {
  buildAgentSectionArtifacts,
  buildAgentSectionHeader,
} from "../../src/render/utils/agents.js";
import { formatAgentBadge } from "../../src/render/utils/badges.js";
import { colorize } from "../../src/utils/colors.js";

describe("buildAgentSectionHeader", () => {
  it("renders status label with color", () => {
    const header = buildAgentSectionHeader({
      agentId: "codex",
      status: "succeeded",
      startedAt: "2025-10-13T00:00:00.000Z",
      completedAt: "2025-10-13T01:02:05.000Z",
    });

    expect(header).toBe(
      `  ${formatAgentBadge("codex")} ${colorize("SUCCEEDED", "green")}`,
    );
  });

  it("falls back to status when timestamps are invalid", () => {
    const header = buildAgentSectionHeader({
      agentId: "claude",
      status: "failed",
      startedAt: "not-a-date",
      completedAt: "2025-10-13T00:00:00.000Z",
    });

    expect(header).toBe(
      `  ${formatAgentBadge("claude")} ${colorize("FAILED", "red")}`,
    );
  });
});

describe("buildAgentSectionArtifacts", () => {
  it("lists artifacts in summary/diff/chat/stdout/stderr order", () => {
    const lines = buildAgentSectionArtifacts({
      agentId: "codex",
      status: "succeeded",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
      assets: {
        summaryPath: "artifacts/summary.txt",
        diffPath: "artifacts/diff.patch",
        chatPath: "artifacts/chat.jsonl",
        stdoutPath: "artifacts/stdout.log",
        stderrPath: "artifacts/stderr.log",
      },
    });

    const rows = lines.slice(1).map((line) => line.trim().split(/\s+/)[0]);
    expect(rows).toEqual(["summary", "diff", "chat", "stdout", "stderr"]);
  });
});
