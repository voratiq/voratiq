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
  baseSnapshotPath: string;
  candidates: Array<{
    candidateId: string;
    diffPath: string;
  }>;
  repoRootPath: string;
  workspacePath: string;
}

export interface ReviewPromptBuildResult {
  prompt: string;
  leakageCheckPrompt: string;
}

export function buildReviewPrompt(
  options: BuildReviewPromptOptions,
): ReviewPromptBuildResult {
  const {
    runId,
    specPath,
    artifactInfoPath,
    outputPath,
    baseSnapshotPath,
    candidates,
    repoRootPath,
    workspacePath,
  } = options;

  const sortedCandidates = [...candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  const sortedCandidateIds = sortedCandidates.map(
    (candidate) => candidate.candidateId,
  );

  const candidateList =
    sortedCandidates.length === 0
      ? ["- (no candidates recorded)"]
      : sortedCandidates.map(
          (candidate) =>
            `- ${candidate.candidateId}: \`${candidate.diffPath}\``,
        );

  const lines: string[] = [
    "You are the reviewer for a completed Voratiq run. Compare each eligible candidate's implementation evidence and recommend exactly one top candidate.",
    "",
    "Inputs:",
    `- Spec path: ${specPath}`,
    `- Base snapshot (read-only): \`${baseSnapshotPath}\``,
    "",
    "Candidate diffs (blinded):",
    ...candidateList,
    "",
    `Run artifact information: \`${artifactInfoPath}\` (JSON, in the workspace root).`,
    "- Use it as the index of what exists and where.",
    "- If an artifact is missing or unreadable, call it out explicitly.",
    "",
    "Decision framework (in order):",
    "1) Correctness & spec adherence.",
    "2) Foundation value: strongest non-overengineered design/architecture that supports iteration and future changes.",
    "3) Apply risk: migration risk, rollback difficulty, uncertainty, and blast radius.",
    "4) Evidence strength: prefer what is demonstrably true from artifacts over plausible inference.",
    "5) Churn (diff size) is a tie-breaker only when (1)-(4) are effectively equal.",
    "6) Eval/lint/typecheck/test outcomes are useful secondary signals, not primary ranking criteria by themselves.",
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
    "Output contract (must follow exactly):",
    "- Include all sections below in the same order.",
    "- `## Ranking` must appear immediately before `## Recommendation`.",
    "- Candidate assessments must be listed in lexicographic candidate-id order.",
    "- Candidate IDs for this review set (lexicographic):",
    ...(sortedCandidateIds.length === 0
      ? ["  - (no candidates recorded)"]
      : sortedCandidateIds.map((candidateId) => `  - ${candidateId}`)),
    "- Inside each candidate assessment block, discuss only that candidate.",
    "- Put all cross-candidate comparisons only in `## Comparison`, `## Ranking`, and `## Recommendation`.",
    "- `## Ranking` must be a strict best-to-worst list of all candidates with no ties.",
    "",
    `# Review of Run ${runId}`,
    "",
    "## Specification",
    `**Path**: ${specPath}`,
    "**Summary**: <1-2 sentence description of the spec and success criteria>",
    "",
    "## Key Requirements",
    "- R1: <requirement>",
    "- R2: <requirement>",
    "- …",
    "",
    "## Candidate Assessments",
    "### <candidate-id>",
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
    "<Repeat one `### <candidate-id>` block for each candidate, in lexicographic candidate-id order>",
    "",
    "## Comparison",
    "<Synthesize differences and trade-offs across candidates, explicitly calling out foundation vs cleanliness when relevant>",
    "",
    "## Ranking",
    "1. <candidate-id>",
    "2. <candidate-id>",
    "3. <candidate-id>",
    "...",
    "<Include every candidate exactly once from best to worst. No ties.>",
    "",
    "## Recommendation",
    "**Preferred Candidate**: <candidate-id>",
    "**Rationale**: <why the top-ranked candidate is best; name key trade-offs and supporting evidence>",
    "**Next Actions**:",
    "<one line per recommendation, e.g. `voratiq apply --run <run-id> --agent <candidate-id>`>",
    "",
    "## Recommendation Artifact (JSON)",
    "In addition to the markdown recommendation above, write `recommendation.json` with this exact shape:",
    `{"preferred_agent":"<candidate-id>","rationale":"<summary>","next_actions":["<action>"]}`,
    "- `preferred_agent` must be exactly one candidate id and must match ranking #1",
    "- Do not include a `version` field",
    "- `rationale` must be a string",
    "- `next_actions` must be an array of action strings",
  ];

  const leakageCheckPrompt = `${lines.join("\n")}\n`;

  appendConstraints(lines, {
    readAccess: repoRootPath,
    writeAccess: workspacePath,
  });
  appendOutputRequirements(lines, [
    `- Save the full review to \`${outputPath}\` in the workspace root.`,
    "- Save the machine-readable recommendation to `recommendation.json` in the workspace root.",
  ]);

  return {
    prompt: `${lines.join("\n")}\n`,
    leakageCheckPrompt,
  };
}
