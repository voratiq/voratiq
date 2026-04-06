import { describe, expect, it } from "@jest/globals";

import { buildMessagePrompt } from "../../../../src/domain/message/competition/prompt.js";

describe("buildMessagePrompt", () => {
  it("uses task-first framing with minimal guidance", () => {
    const prompt = buildMessagePrompt({
      prompt: "Review commit 013bdf0.",
      repoRootPath: "/repo",
      workspacePath:
        "/repo/.voratiq/message/sessions/message-123/agent-a/workspace",
    });

    expect(prompt).toContain(
      "Respond to the prompt below using the available repository context.",
    );
    expect(prompt).toContain("Guidance:");
    expect(prompt).toContain("- Inspect the repository directly when needed.");
    expect(prompt).toContain("- Keep the response focused on the prompt.");
    expect(prompt).toContain("Prompt:");
    expect(prompt).not.toContain("isolated recipient");
    expect(prompt).not.toContain("cold request/response exchange");
    expect(prompt).not.toContain("Original prompt:");
    expect(prompt).not.toContain("reply-oriented task");
  });

  it("retains runtime constraints and workspace output requirements", () => {
    const prompt = buildMessagePrompt({
      prompt: "Review commit 013bdf0.",
      repoRootPath: "/repo",
      workspacePath:
        "/repo/.voratiq/message/sessions/message-123/agent-a/workspace",
    });

    expect(prompt).toContain("- Read access: `/repo`.");
    expect(prompt).toContain(
      "- Write access: `/repo/.voratiq/message/sessions/message-123/agent-a/workspace`.",
    );
    expect(prompt).toContain(
      "Write the response to `response.md` in the workspace root.",
    );
    expect(prompt).not.toContain("response.json");
  });
});
