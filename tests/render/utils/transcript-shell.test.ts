import { describe, expect, it } from "@jest/globals";

import { formatTranscriptBadge } from "../../../src/render/utils/transcript-shell.js";

describe("formatTranscriptBadge", () => {
  it("renders the message badge with the shared off-white background", () => {
    const badge = formatTranscriptBadge("message-123", "message", {
      isTty: true,
    });

    expect(badge).toContain("\u001B[48;2;252;251;248m");
    expect(badge).toContain("\u001B[38;2;0;0;0m");
  });
});
