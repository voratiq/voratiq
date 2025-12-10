import { generateRunId } from "../../src/commands/run/id.js";

describe("generateRunId", () => {
  it("builds a timestamped identifier with slug", () => {
    const date = new Date(Date.UTC(2025, 9, 1, 14, 35, 0));
    const id = generateRunId(date);

    expect(id.startsWith("20251001-143500-")).toBe(true);
    const slug = id.split("-")[2];
    expect(slug).toHaveLength(5);
  });
});
