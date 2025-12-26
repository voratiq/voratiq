import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { colorize } from "../../utils/colors.js";
import { formatRunWorkspaceRelative } from "../../workspace/layout.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTranscriptWithMetadata } from "./shared.js";

export function renderReviewTranscript(run: RunRecordEnhanced): string {
  const enhanced = run;
  const beforeAgents =
    enhanced.status === "pruned"
      ? [
          [
            colorize(
              "Note: Run was pruned; associated artifacts may no longer be available.",
              "yellow",
            ),
          ],
        ]
      : undefined;

  const hasEvalIssues = enhanced.agents.some((agent) =>
    agent.evals.some(
      (evaluation) =>
        evaluation.status === "failed" || evaluation.status === "errored",
    ),
  );

  const warnings = hasEvalIssues
    ? [
        `${colorize("Warning:", "yellow")} Evaluation issues detected. Review logs before proceeding.`,
      ]
    : undefined;

  return renderTranscriptWithMetadata({
    metadata: {
      runId: enhanced.runId,
      status: enhanced.status,
      specPath: enhanced.spec.path,
      workspacePath: formatRunWorkspaceRelative(enhanced.runId),
      createdAt: formatRunTimestamp(enhanced.createdAt),
      baseRevisionSha: enhanced.baseRevisionSha,
    },
    agents: enhanced.agents,
    beforeAgents,
    warnings,
    hint: {
      message: `To integrate a solution:\n  voratiq apply --run ${run.runId} --agent <agent-id>`,
    },
  });
}
