import { describe, expect, it } from "@jest/globals";

import {
  buildStageFrameLines,
  buildStageFrameSections,
  createStageStartLineEmitter,
  renderStageFinalFrame,
} from "../../../src/render/utils/stage-output.js";

describe("stage output primitives", () => {
  it.each(["SUCCEEDED", "FAILED", "ABORTED"])(
    "builds a stable final frame shell for %s",
    (statusLabel) => {
      const metadataLines = [`run-123 ${statusLabel}`, "Elapsed  12s"];
      const statusTableLines = [
        "AGENT      STATUS     DURATION",
        `runner-a  ${statusLabel}  12s`,
      ];
      const footerLines = ["Finalized."];

      const sections = buildStageFrameSections({
        metadataLines,
        statusTableLines,
        footerLines,
      });
      const rendered = renderStageFinalFrame({
        metadataLines,
        statusTableLines,
        footerLines,
        hint: { message: "Next step" },
      });

      expect(sections).toEqual([metadataLines, statusTableLines, footerLines]);
      expect(rendered).toContain(`run-123 ${statusLabel}`);
      expect(rendered).toContain("AGENT      STATUS     DURATION");
      expect(rendered).toContain("Finalized.");
      expect(rendered).toContain("Next step");
    },
  );

  it("renders stage frame lines with leading and trailing blank lines", () => {
    const lines = buildStageFrameLines({
      metadataLines: ["run-123 SUCCEEDED"],
      statusTableLines: ["AGENT  STATUS", "runner SUCCEEDED"],
      leadingBlankLine: true,
      trailingBlankLine: true,
    });

    expect(lines[0]).toBe("");
    expect(lines).toContain("run-123 SUCCEEDED");
    expect(lines).toContain("AGENT  STATUS");
    expect(lines[lines.length - 1]).toBe("");
  });

  it("emits start copy exactly once", () => {
    const writes: string[] = [];
    const emitter = createStageStartLineEmitter((copy) => {
      writes.push(copy);
    });

    emitter.emit("Executing run…");
    emitter.emit("Executing run…");
    emitter.emit("Generating review…");

    expect(writes).toEqual(["Executing run…"]);
  });

  it("ignores empty start copy", () => {
    const writes: string[] = [];
    const emitter = createStageStartLineEmitter((copy) => {
      writes.push(copy);
    });

    emitter.emit("   ");
    emitter.emit("Generating review…");

    expect(writes).toEqual(["Generating review…"]);
  });
});
