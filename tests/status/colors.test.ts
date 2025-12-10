import {
  getAgentStatusStyle,
  getEvalStatusStyle,
  getRunStatusStyle,
} from "../../src/status/colors.js";
import {
  AGENT_STATUS_VALUES,
  EVAL_STATUS_VALUES,
  RUN_STATUS_VALUES,
} from "../../src/status/index.js";

describe("status color helpers", () => {
  it("maps every agent status to a color", () => {
    const palette = new Set<string>();
    for (const status of AGENT_STATUS_VALUES) {
      const style = getAgentStatusStyle(status);
      expect(style.cli).toBeDefined();
      palette.add(style.cli);
    }
    expect(palette).toEqual(
      new Set(["green", "red", "yellow", "cyan", "gray"]),
    );
  });

  it("maps eval statuses to deterministic colors", () => {
    const colors = EVAL_STATUS_VALUES.map(
      (status: (typeof EVAL_STATUS_VALUES)[number]) =>
        getEvalStatusStyle(status).cli,
    );
    expect(colors).toEqual(["green", "red", "red", "gray"]);
  });

  it("maps run statuses to deterministic colors", () => {
    const colors = RUN_STATUS_VALUES.map(
      (status: (typeof RUN_STATUS_VALUES)[number]) =>
        getRunStatusStyle(status).cli,
    );
    expect(colors).toEqual([
      "gray",
      "cyan",
      "green",
      "red",
      "red",
      "yellow",
      "gray",
    ]);
  });
});
