import { describe, expect, it } from "@jest/globals";

import {
  FIRST_PARTY_ATTACHED_LAUNCH_PROMPT,
  resolveFirstPartyLaunchPrompt,
} from "../../../src/domain/interactive/prompt.js";
import { VORATIQ_GUIDE_RESOURCE_URI } from "../../../src/mcp/server.js";

describe("FIRST_PARTY_ATTACHED_LAUNCH_PROMPT", () => {
  it("is 3 sentences or fewer", () => {
    const sentences = FIRST_PARTY_ATTACHED_LAUNCH_PROMPT.split(
      /(?<=[.!?])\s+/u,
    ).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it("references the guide resource URI", () => {
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      VORATIQ_GUIDE_RESOURCE_URI,
    );
  });

  it("keeps launch guidance concise and points to the guide", () => {
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      "workflow state and actions",
    );
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain("operating contract");
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      "workflow composition",
    );
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain("operator reference");
    expect(wordCount(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT)).toBeLessThanOrEqual(
      75,
    );
  });

  it("frames the agent role as orchestrating workflows through Voratiq tools", () => {
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      "Your role is to orchestrate Voratiq workflows for the user through these tools",
    );
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      "preserving sessions and apply outcomes",
    );
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain("local edits");
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain("replacement stages");
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain("manual apply paths");
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      "unless explicitly instructed otherwise",
    );
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain("discipline rules");
  });

  it("is returned by resolveFirstPartyLaunchPrompt when tools are attached", () => {
    expect(resolveFirstPartyLaunchPrompt("attached")).toBe(
      FIRST_PARTY_ATTACHED_LAUNCH_PROMPT,
    );
  });

  it("is not returned by resolveFirstPartyLaunchPrompt when tools are not attached", () => {
    expect(resolveFirstPartyLaunchPrompt("failed")).toBeUndefined();
    expect(resolveFirstPartyLaunchPrompt("not-requested")).toBeUndefined();
  });
});

function wordCount(input: string): number {
  return input
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0).length;
}
