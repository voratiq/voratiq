import {
  appendExtraContextPromptSection,
  type ResolvedExtraContextFile,
} from "../../../competition/shared/extra-context.js";
import {
  appendConstraints,
  appendOutputRequirements,
  buildWorkspaceArtifactRequirements,
} from "../../../competition/shared/prompt-helpers.js";

export interface BuildReducePromptOptions {
  targetOperator: "spec" | "run" | "verify" | "reduction";
  targetId: string;
  artifactInfoPath: string;
  repoRootPath: string;
  workspacePath: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
}

export function buildReducePrompt(options: BuildReducePromptOptions): string {
  const {
    targetOperator,
    targetId,
    artifactInfoPath,
    repoRootPath,
    workspacePath,
    extraContextFiles = [],
  } = options;

  const lines: string[] = [
    "You are the reducer for a completed Voratiq session. Read the available artifacts, synthesize what should be carried forward, and write both a human-readable reduction and a machine-readable reduction artifact.",
    "",
    "Inputs:",
    `- Target operator: ${targetOperator}`,
    `- Target session id: ${targetId}`,
    `- Artifact information: \`${artifactInfoPath}\``,
    "",
    "Large artifacts and context budget:",
    "- Do not use subagents.",
    "- Start from `artifact-information.json` and inspect only the most decision-relevant artifacts.",
    "- Make claims only when grounded in visible artifacts.",
    "",
    "Suggested workflow:",
    "1) Read `artifact-information.json` first.",
    "2) Inspect the most relevant staged artifacts one by one.",
    "3) For each source, identify its strongest useful contributions and its key weaknesses or limitations.",
    "4) Synthesize only the durable cross-source guidance, risks, and follow-on direction.",
    "5) Write `reduction.md` and `reduction.json` in the workspace root.",
    "",
    "Goal:",
    "- Produce carry-forward context for a later `spec`, `run`, `reduce`, or `verify` invocation.",
    "- Focus on synthesis, not ranking or selecting a single best artifact.",
    "- Optimize for next-step utility, not audit completeness.",
    "- If something is uncertain, say so explicitly.",
    "- Prefer the smallest useful reduction that preserves durable guidance.",
    "",
    "Output contract (must follow exactly):",
    "- Produce two artifacts: the full reduction and the machine-readable reduction.",
    "- The machine-readable artifact must contain only the final synthesized carry-forward result.",
    "",
    "## reduction.md",
    "Write markdown with this shape:",
    "## Reduction",
    "**Sources**: <artifact-id>, <artifact-id>",
    "",
    "## Source Assessments",
    "### <artifact-id>",
    "**Strengths**:",
    "- <strength>",
    "- <strength>",
    "**Weaknesses**:",
    "- <weakness>",
    "- <weakness>",
    "<Repeat one `### <artifact-id>` block for each important source you relied on>",
    "",
    "## Synthesis",
    "**Summary**: <1-3 sentence synthesis>",
    "**Directives**:",
    "- <instruction>",
    "- <instruction>",
    "**Risks**:",
    "- <risk>",
    "- <risk>",
    "",
    "## reduction.json",
    "The machine-readable reduction must match the same synthesis described in `## Synthesis`.",
    `{"summary":"<summary>","directives":["<directive>"],"risks":["<risk>"]}`,
    "- `reduction.json` must contain only the final synthesized carry-forward result, not per-source assessments.",
    "- Keep `summary`, `directives`, and `risks` concise and reusable.",
    "- Include only the strongest durable guidance; do not restate every source artifact.",
    "- Prefer 3-6 directives and 2-5 risks unless the evidence is unusually sparse.",
    "- Merge overlapping findings instead of listing near-duplicates.",
  ];

  appendConstraints(lines, {
    readAccess: repoRootPath,
    writeAccess: workspacePath,
  });
  appendExtraContextPromptSection(lines, extraContextFiles);
  appendOutputRequirements(
    lines,
    buildWorkspaceArtifactRequirements([
      {
        instruction: "Save the full reduction",
        path: "reduction.md",
      },
      {
        instruction: "Save the machine-readable reduction",
        path: "reduction.json",
        schema: {
          leadIn: "with this shape",
          content: [
            '`{"summary":"<summary>","directives":["<directive>"],"risks":["<risk>"]}`',
            "- `reduction.json` must contain only the final synthesized carry-forward result, not per-source assessments.",
            "- Keep `summary`, `directives`, and `risks` concise and reusable.",
            "- Include only the strongest durable guidance; do not restate every source artifact.",
            "- Prefer 3-6 directives and 2-5 risks unless the evidence is unusually sparse.",
            "- Merge overlapping findings instead of listing near-duplicates.",
          ],
        },
      },
    ]),
  );

  return `${lines.join("\n")}\n`;
}
