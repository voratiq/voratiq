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
  outputPath: string;
  repoRootPath: string;
  workspacePath: string;
}

export function buildReviewPrompt(options: BuildReviewPromptOptions): string {
  const {
    runId,
    runStatus,
    specPath,
    artifactInfoPath,
    outputPath,
    repoRootPath,
    workspacePath,
  } = options;

  const lines: string[] = [
    "You are the reviewer for a completed Voratiq run. Compare each agent's implementation and recommend what to apply (if anything).",
    "",
    "Inputs:",
    `- Run id: ${runId}`,
    `- Status: ${runStatus}`,
    `- Spec path: ${specPath}`,
    "",
    `Run artifact information: \`${artifactInfoPath}\` (JSON, in the workspace root).`,
    "- Use it as the index of what exists and where.",
    "- If an artifact is missing or unreadable, call it out explicitly.",
    "",
    "Decision framework (in order):",
    "1) Correctness & spec adherence.",
    "2) Foundation value: design/architecture that supports iteration and future changes.",
    "3) Apply risk: migration risk, rollback difficulty, uncertainty, and blast radius.",
    "4) Evidence strength: prefer what is demonstrably true from artifacts over plausible inference.",
    "5) Churn (diff size) is a tie-breaker only when (1)-(4) are effectively equal.",
    "",
    "Foundation vs apply-now cleanliness:",
    "- Prefer the best foundation even if it needs cleanup, when correctness looks solid and the follow-up work is bounded and low-risk.",
    "- Prefer the cleaner/apply-now option when the bigger/foundation option has correctness risk, unclear spec mapping, or unbounded cleanup.",
    "- When choosing a foundation, explicitly list the follow-up tasks required to reach production quality.",
    "",
    "Evidence and signals:",
    "- Artifacts: make claims only when you can point to evidence (diffs, logs, file paths). If you cannot verify, say Not verifiable and explain what's missing.",
    "- Evals: interpret what each eval measures and how hard it is to fix. Some failures are cleanup (e.g., format/lint), some are correctness risk (e.g., typecheck/tests), and some are infra/no-signal (e.g., sandbox path errors). Passing evals does not prove full spec coverage.",
    "- Docs-heavy diffs: do not add new product/behavior claims; focus on what changed and whether it matches the spec.",
    "",
    "Output template (use this structure):",
    "",
    `# Review of Run ${runId}`,
    "",
    "## Specification",
    `**Path**: ${specPath}`,
    "**Summary**: <1-2 sentence description of the spec and success criteria>",
    "",
    "## Key Requirements (from spec)",
    "- R1: <requirement>",
    "- R2: <requirement>",
    "- …",
    "",
    "## Agent: <agent-id>",
    "**Status**: <status>",
    "**Assessment**: Strong foundation | Apply-now | Not recommended",
    "**Quality**: High | Medium | Low",
    "**Eval Signal**: <eval-slug> <status> | <eval-slug> <status> | … (use evals from the artifact information)",
    "**Requirements Coverage**:",
    "- R1: Met | Partial | Not Met | Not verifiable — Evidence: <artifact/file path/log reference>",
    "- R2: Met | Partial | Not Met | Not verifiable — Evidence: <...>",
    "- …",
    "**Implementation Notes**: <decision-critical notes about correctness, design, and risks; cite artifacts>",
    "**Follow-up (if applied)**: <bounded TODOs needed after apply; include cleanup, missing tests, docs follow-ups>",
    "<Repeat this section for each agent listed in the artifact information>",
    "",
    "## Comparison",
    "<Synthesize differences and trade-offs across agents, explicitly calling out foundation vs cleanliness when relevant>",
    "",
    "## Risks / Missing Artifacts",
    "<List missing or unreadable artifacts; explain impact>",
    "",
    "## Recommendation",
    "**Preferred Agent(s)**: <agent-id(s) or `none`>",
    "**Rationale**: <why these are best (or why none qualify); name the key trade-offs and what evidence supports the choice>",
    "**Next Actions**:",
    "<one line per recommendation, e.g. `voratiq apply --run <run-id> --agent <agent-id>`>",
    "",
    "## Recommendation Artifact (JSON)",
    "In addition to the markdown recommendation above, write `recommendation.json` with this exact shape:",
    `{"version":1,"preferred_agents":["<agent-id>"],"rationale":"<summary>","next_actions":["<action>"]}`,
    "- `version` must be `1`",
    "- `preferred_agents` must be an array of agent ids (or empty if no agent is recommended)",
    "- `rationale` must be a string",
    "- `next_actions` must be an array of action strings",
  ];

  appendConstraints(lines, {
    readAccess: repoRootPath,
    writeAccess: workspacePath,
  });
  appendOutputRequirements(lines, [
    `- Save the full review to \`${outputPath}\` in the workspace root.`,
    "- Save the machine-readable recommendation to `recommendation.json` in the workspace root.",
  ]);

  return `${lines.join("\n")}\n`;
}
