import {
  AGENT_STATUS_VALUES,
  EVAL_REQUIRED_AGENT_STATUSES,
  IN_PROGRESS_AGENT_STATUSES,
  REVIEW_STATUS_VALUES,
  RUN_STATUS_VALUES,
  SPEC_RECORD_STATUS_VALUES,
  TERMINABLE_RUN_STATUSES,
  TERMINAL_AGENT_STATUSES,
  TERMINAL_REVIEW_STATUSES,
  TERMINAL_SPEC_STATUSES,
} from "../../src/status/index.js";

describe("status groupings", () => {
  describe("agent status groupings", () => {
    it("TERMINAL_AGENT_STATUSES contains only valid AgentStatus values", () => {
      for (const status of TERMINAL_AGENT_STATUSES) {
        expect(AGENT_STATUS_VALUES).toContain(status);
      }
    });

    it("IN_PROGRESS_AGENT_STATUSES contains only valid AgentStatus values", () => {
      for (const status of IN_PROGRESS_AGENT_STATUSES) {
        expect(AGENT_STATUS_VALUES).toContain(status);
      }
    });

    it("EVAL_REQUIRED_AGENT_STATUSES contains only valid AgentStatus values", () => {
      for (const status of EVAL_REQUIRED_AGENT_STATUSES) {
        expect(AGENT_STATUS_VALUES).toContain(status);
      }
    });

    it("agent status groupings are mutually exclusive and exhaustive", () => {
      const terminal = new Set(TERMINAL_AGENT_STATUSES);
      const inProgress = new Set(IN_PROGRESS_AGENT_STATUSES);

      // No overlap between terminal and in-progress
      for (const status of terminal) {
        expect(inProgress.has(status)).toBe(false);
      }
      for (const status of inProgress) {
        expect(terminal.has(status)).toBe(false);
      }

      // All agent statuses are covered
      const allGrouped = new Set([
        ...TERMINAL_AGENT_STATUSES,
        ...IN_PROGRESS_AGENT_STATUSES,
      ]);
      expect(allGrouped.size).toBe(AGENT_STATUS_VALUES.length);
      for (const status of AGENT_STATUS_VALUES) {
        expect(allGrouped.has(status)).toBe(true);
      }
    });

    it("EVAL_REQUIRED_AGENT_STATUSES is a subset of TERMINAL_AGENT_STATUSES", () => {
      const terminal = new Set(TERMINAL_AGENT_STATUSES);
      for (const status of EVAL_REQUIRED_AGENT_STATUSES) {
        expect(terminal.has(status)).toBe(true);
      }
    });
  });

  describe("run status groupings", () => {
    it("TERMINABLE_RUN_STATUSES contains only valid RunStatus values", () => {
      for (const status of TERMINABLE_RUN_STATUSES) {
        expect(RUN_STATUS_VALUES).toContain(status);
      }
    });
  });

  describe("review status groupings", () => {
    it("TERMINAL_REVIEW_STATUSES contains only valid ReviewStatus values", () => {
      for (const status of TERMINAL_REVIEW_STATUSES) {
        expect(REVIEW_STATUS_VALUES).toContain(status);
      }
    });

    it("TERMINAL_REVIEW_STATUSES excludes running", () => {
      expect(TERMINAL_REVIEW_STATUSES).not.toContain("running");
    });
  });

  describe("spec status groupings", () => {
    it("TERMINAL_SPEC_STATUSES contains only valid SpecRecordStatus values", () => {
      for (const status of TERMINAL_SPEC_STATUSES) {
        expect(SPEC_RECORD_STATUS_VALUES).toContain(status);
      }
    });

    it("TERMINAL_SPEC_STATUSES excludes in-progress statuses", () => {
      const inProgressSpecStatuses = [
        "drafting",
        "awaiting-feedback",
        "refining",
        "saving",
      ];
      for (const status of inProgressSpecStatuses) {
        expect(TERMINAL_SPEC_STATUSES).not.toContain(status);
      }
    });
  });
});
