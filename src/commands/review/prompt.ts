import {
  appendConstraints,
  appendOutputRequirements,
} from "../shared/prompt-helpers.js";

export interface BuildReviewPromptOptions {
  runId: string;
  runStatus: string;
  specPath: string;
  baseRevisionSha: string;
  createdAt: string;
  completedAt?: string;
  artifactInfoPath: string;
  reviewOutputPath: string;
  repoRootPath: string;
  reviewWorkspaceRoot: string;
}

export function buildReviewPrompt(options: BuildReviewPromptOptions): string {
  const {
    runId,
    runStatus,
    specPath,
    baseRevisionSha,
    createdAt,
    completedAt,
    artifactInfoPath,
    reviewOutputPath,
    repoRootPath,
    reviewWorkspaceRoot,
  } = options;

  const lines: string[] = [
    "You are the reviewer for a completed Voratiq run.",
    "Your job is to judge the quality of each agent's implementation, compare approaches, and recommend what to apply (if anything).",
    "",
    "Review goal:",
    "- Help a human decide whether to apply any agent output.",
    "- Lead with code quality and spec coverage; evals are secondary signals.",
    "",
    "Inputs:",
    `- Run id: ${runId}`,
    `- Status: ${runStatus}`,
    `- Spec path: ${specPath}`,
    `- Base revision: ${baseRevisionSha}`,
    `- Created at: ${createdAt}`,
    ...(completedAt ? [`- Completed at: ${completedAt}`] : []),
    "",
    `Run artifact information: \`${artifactInfoPath}\` (JSON, in the workspace root).`,
    "- Use it as the index of what exists and where.",
    "- If an artifact is missing or unreadable, call it out explicitly.",
    "",
    "Workflow (execute in order, no interaction):",
    "1) Read the spec and capture key requirements/constraints.",
    "2) Inspect each agent's artifacts listed in the artifact information (summary, diff, eval logs, stdout/stderr).",
    "3) Evaluate implementation quality, spec coverage, and risks per agent.",
    "4) Compare agents and rank them; weigh trade-offs.",
    "5) Recommend whether to apply one, multiple, or none with explicit commands.",
    "",
    "Evaluation principles:",
    "- Lead with code quality, clarity, and spec adherence.",
    "- Treat evals as secondary diagnostic signals, not the primary decision driver.",
    "- Prefer smaller, safer diffs when quality is otherwise comparable.",
    "- Stay grounded in artifacts; cite file paths/behaviors.",
    "- Call out follow-up work explicitly.",
    "",
    "Output template (use this structure):",
    "",
    `# Review of Run ${runId}`,
    "",
    "## Specification",
    `**Path**: ${specPath}`,
    "**Summary**: <1-2 sentence description of the spec>",
    "",
    "## Agent: <agent-id>",
    "**Status**: <status>",
    "**Quality**: High | Medium | Low",
    "**Eval Signal**: <eval-slug> <status> | <eval-slug> <status> | … (use evals from the artifact information)",
    "**Implementation Review**: <assess code quality, spec coverage, notable choices; cite eval insights as context>",
    "**Follow-up Notes**: <issues, risks, or work needed post-apply>",
    "<Repeat this section for each agent listed in the artifact information>",
    "",
    "## Comparison",
    "<Synthesize differences and trade-offs across agents>",
    "",
    "## Risks / Missing Artifacts",
    "<List missing or unreadable artifacts; explain impact>",
    "",
    "## Recommendation",
    "**Preferred Agent(s)**: <agent-id(s) or `none`>",
    "**Rationale**: <why these are best (or why none qualify)>",
    "**Next Actions**:",
    "<one line per recommendation, e.g. `voratiq apply --run <run-id> --agent <agent-id>`>",
  ];

  appendConstraints(lines, {
    readAccess: repoRootPath,
    writeAccess: reviewWorkspaceRoot,
  });
  appendOutputRequirements(lines, [
    `- Save the full review to \`${reviewOutputPath}\` in the workspace root.`,
  ]);

  return `${lines.join("\n")}\n`;
}
