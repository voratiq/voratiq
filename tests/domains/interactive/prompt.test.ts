import { describe, expect, it } from "@jest/globals";

import {
  FIRST_PARTY_ATTACHED_LAUNCH_PROMPT,
  resolveFirstPartyLaunchPrompt,
} from "../../../src/domain/interactive/prompt.js";
import { VORATIQ_GUIDE_RESOURCE_URI } from "../../../src/mcp/server.js";

describe("FIRST_PARTY_ATTACHED_LAUNCH_PROMPT", () => {
  it("is 3 sentences or fewer", () => {
    const sentences = FIRST_PARTY_ATTACHED_LAUNCH_PROMPT.split(/(?<=[.!?])\s+/u).filter(
      (s) => s.trim().length > 0,
    );
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it("references the guide resource URI", () => {
    expect(FIRST_PARTY_ATTACHED_LAUNCH_PROMPT).toContain(
      VORATIQ_GUIDE_RESOURCE_URI,
    );
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
