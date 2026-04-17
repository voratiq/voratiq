import { describe, expect, it } from "@jest/globals";

import {
  formatTranscriptBadge,
  type TranscriptBadgeVariant,
} from "../../../src/render/utils/transcript-shell.js";

describe("formatTranscriptBadge", () => {
  it("renders transcript badges with the configured palette", () => {
    const expectedBackgrounds = {
      spec: "\u001B[48;2;144;190;228m",
      run: "\u001B[48;2;164;203;153m",
      reduce: "\u001B[48;2;226;159;115m",
      verify: "\u001B[48;2;251;228;141m",
      message: "\u001B[48;2;188;180;230m",
      interactive: "\u001B[48;2;250;250;250m",
    } satisfies Record<Exclude<TranscriptBadgeVariant, "agent">, string>;

    const badgeEntries = Object.entries(expectedBackgrounds) as Array<
      [Exclude<TranscriptBadgeVariant, "agent">, string]
    >;

    for (const [variant, background] of badgeEntries) {
      const badge = formatTranscriptBadge("session-123", variant, {
        isTty: true,
      });

      expect(badge).toContain(background);
      expect(badge).toContain("\u001B[38;2;0;0;0m");
    }
  });
});
