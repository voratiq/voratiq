import type { EnvironmentConfig } from "../configs/environment/types.js";
import { normalizeProgrammaticCommand } from "../configs/verification/methods.js";
import { listDetectedProgrammaticDefaults } from "../configs/verification/programmatic-defaults.js";
import { detectProgrammaticSuggestions } from "../configs/verification/programmatic-detect.js";

const DEFAULT_SPEC_RUBRIC = [{ template: "spec-verification" }] as const;
const DEFAULT_RUN_RUBRIC = [{ template: "run-verification" }] as const;
const DEFAULT_REDUCE_RUBRIC = [{ template: "reduce-verification" }] as const;

export async function buildDefaultVerificationConfigYaml(params: {
  root: string;
  environment: EnvironmentConfig;
}): Promise<string> {
  const suggestions = await detectProgrammaticSuggestions(
    params.root,
    params.environment,
  );
  const runProgrammaticDefaults = listDetectedProgrammaticDefaults(
    suggestions,
  ).flatMap((entry) => {
    const command = normalizeProgrammaticCommand(entry.command);
    return command ? [{ slug: entry.slug, command }] : [];
  });

  const lines: string[] = [];
  appendRubricStage(lines, "spec", DEFAULT_SPEC_RUBRIC);
  lines.push("");
  appendRunStage(lines, runProgrammaticDefaults);
  lines.push("");
  appendRubricStage(lines, "reduce", DEFAULT_REDUCE_RUBRIC);

  return `${lines.join("\n")}\n`;
}

function appendRunStage(
  lines: string[],
  runProgrammaticDefaults: ReadonlyArray<{ slug: string; command: string }>,
): void {
  lines.push("run:");

  if (runProgrammaticDefaults.length > 0) {
    lines.push("  programmatic:");
    for (const entry of runProgrammaticDefaults) {
      lines.push(`    ${entry.slug}: ${JSON.stringify(entry.command)}`);
    }
    lines.push("");
  }

  lines.push("  rubric:");
  for (const entry of DEFAULT_RUN_RUBRIC) {
    lines.push(`    - template: ${entry.template}`);
  }
}

function appendRubricStage(
  lines: string[],
  stage: "spec" | "reduce",
  rubric: ReadonlyArray<{ template: string }>,
): void {
  lines.push(`${stage}:`);
  lines.push("  rubric:");
  for (const entry of rubric) {
    lines.push(`    - template: ${entry.template}`);
  }
}

export interface ShippedVerificationTemplate {
  name: "spec-verification" | "run-verification" | "reduce-verification";
  prompt: string;
  rubric: string;
  schema: string;
}

export const SHIPPED_VERIFICATION_TEMPLATES: readonly ShippedVerificationTemplate[] =
  [
    {
      name: "spec-verification",
      prompt: `You are a blinded verifier agent reviewing multiple spec drafts for the same task and choosing the single best draft to execute.

Method boundary:

- produce per-draft assessments and a final ranking in one structured output

Inputs:

- the original task description
- the full blinded draft set
- any shared context needed to understand the intended outcome

Expected working style:

1. Read the original task description first.
2. Derive the key contract items the draft must preserve and use stable ids such as \`C1\`, \`C2\`, \`C3\`.
3. Inspect the draft set directly.
4. Assess each draft against the verification rubric.
5. Record per-draft contract coverage, draft readiness, recommendation posture, and bounded follow-up work.
6. Derive a strict best-to-worst ranking from those assessments.
7. Make the ranking strict, complete, and tie-free across the full draft set.
8. Set \`preferred\` equal to \`ranking[0]\`.

Judgment discipline:

- focus on whether the draft preserves the requested task and acceptance bar, not whether it sounds polished
- make claims only when you can point to concrete draft text or source-task evidence
- call out hidden assumptions, ambiguous boundaries, and missing execution contracts explicitly
- treat decomposition as a quality dimension, not a mandatory outcome; a draft can be strong if it stays atomic for the right task
- include lightweight \`evidence_refs\` for each draft assessment
- keep \`comparison\` focused on cross-draft tradeoffs such as task fit, decomposition quality, and execute-now readiness
- make \`comparison\` explain why \`ranking[0]\` beat \`ranking[1]\`, not just why lower-ranked drafts lost
- include \`next_actions\` only for the selected draft path

Expected output shape:

- \`assessments[]\` with one entry per draft
- top-level \`preferred\` naming the selected draft
- each assessment should include:
  - \`draft\`
  - \`completion_status\`
  - \`recommendation_level\`
  - \`quality\`
  - \`evaluation\`
  - \`contract_coverage\`
  - \`implementation_notes\`
  - \`follow_up\`
  - \`evidence_refs\`
- top-level \`comparison\` should capture cross-draft tradeoffs
- top-level \`ranking\` must be strict, complete, and tie-free
- top-level \`rationale\` should explain why \`preferred\` / \`ranking[0]\` is the best execution contract
- top-level \`next_actions\` should stay short and operational
`,
      rubric: `# Spec Review

Review the draft set by assessing each draft on:

- task fidelity
- boundary control
- acceptance contract
- decomposition
- execution readiness
- uncertainty handling

Then derive a final ranking from those assessments.

## Task Fidelity

Ask:

- Does the draft preserve the actual requested outcome?
- Does it stay aligned to the originating task rather than drifting into adjacent cleanup or architecture work?
- Are important terms and goals concrete enough to execute against?

Task fidelity should dominate stylistic polish.

Every draft assessment should include explicit \`contract_coverage\` entries so the ranking is traceable back to the originating task rather than inferred from vague quality labels.

## Boundary Control

Ask:

- Is in-scope versus out-of-scope legible?
- Does the draft constrain likely overreach paths?
- Are constraints and non-goals clear enough to keep downstream execution bounded?

## Acceptance Contract

Ask:

- Does the draft define what done looks like?
- Are success conditions checkable rather than aspirational?
- Does it identify the artifacts, behaviors, or tests that should prove completion?

## Decomposition

Ask:

- Does the draft break the work down only when decomposition helps execution?
- If decomposition is present, are the parts coherent, ordered, and complete enough to act on?
- If decomposition is absent, is the task still executable as one bounded unit?

Strong decomposition can mean either a good phased breakdown or a disciplined choice to keep the task atomic.

## Execution Readiness

Ask:

- Could a run agent plausibly execute this draft without major guesswork?
- Does the draft expose concrete contracts for CLI flags, persistence, artifacts, or user-facing behavior when they matter?
- Is the implementation path specific enough to reduce downstream ambiguity?

## Uncertainty Handling

Ask:

- Does the draft surface key assumptions and dependencies?
- Does it expose meaningful uncertainty instead of hiding it?
- Are unresolved questions bounded and explicit?

## Draft posture

Each draft assessment should also name:

- \`completion_status\`: \`ready\`, \`ready_with_gap\`, \`ready_with_gaps\`, \`incomplete\`, or \`not_verifiable\`
- \`recommendation_level\`: \`execute_now\`, \`strong_foundation\`, or \`not_recommended\`
- \`quality\`: \`high\`, \`medium\`, or \`low\`

These fields preserve the practical decision posture a spec selector needs:

- \`execute_now\` means the draft is fit to drive execution without reopening major contract questions
- \`strong_foundation\` means the draft is directionally strong but still needs bounded tightening
- \`not_recommended\` means the draft should not win the stage

Keep descriptive task typing out of this rubric. If you need normalized labels like \`intent\`, \`scope\`, \`stack\`, or \`difficulty\`, use the separate \`spec-type\` rubric.

## Ranking rule

The final ranking should follow from the draft assessments above.

It should answer:

- which draft should win?
- which ordering best reflects execution trustworthiness?

It should not ignore the structured per-draft assessments.
It must rank the full eligible draft set with no ties.
Set \`preferred\` equal to \`ranking[0]\`.

The verification artifact should also include:

- \`comparison\`: cross-draft tradeoffs, explicitly including why \`ranking[0]\` beat \`ranking[1]\`
- \`rationale\`: why \`preferred\` / \`ranking[0]\` is the best choice
- \`next_actions\`: short, operational follow-up for the selected draft path
`,
      schema: `type: object
required:
  - assessments
  - preferred
  - comparison
  - ranking
  - rationale
  - next_actions
properties:
  assessments:
    type: array
    items:
      type: object
      required:
        - draft
        - completion_status
        - recommendation_level
        - quality
        - evaluation
        - contract_coverage
        - implementation_notes
        - follow_up
        - evidence_refs
      properties:
        draft:
          type: string
        completion_status:
          type: string
          enum: ["ready", "ready_with_gap", "ready_with_gaps", "incomplete", "not_verifiable"]
        recommendation_level:
          type: string
          enum: ["execute_now", "strong_foundation", "not_recommended"]
        quality:
          type: string
          enum: ["high", "medium", "low"]
        evaluation:
          type: object
          required:
            - task_fidelity
            - boundary_control
            - acceptance_contract
            - decomposition
            - execution_readiness
            - uncertainty_handling
          properties:
            task_fidelity:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            boundary_control:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            acceptance_contract:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            decomposition:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            execution_readiness:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            uncertainty_handling:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
        contract_coverage:
          type: array
          items:
            type: object
            required:
              - contract_item
              - status
              - note
              - evidence_refs
            properties:
              contract_item:
                type: string
              status:
                type: string
                enum: ["met", "partial", "not_met", "not_verifiable"]
              note:
                type: string
              evidence_refs:
                type: array
                items:
                  type: string
        implementation_notes:
          type: string
        follow_up:
          type: array
          items:
            type: string
        evidence_refs:
          type: array
          items:
            type: string
  comparison:
    type: string
  preferred:
    type: string
  ranking:
    type: array
    items:
      type: string
  rationale:
    type: string
  next_actions:
    type: array
    items:
      type: string
`,
    },
    {
      name: "run-verification",
      prompt: `You are a blinded verifier agent reviewing multiple run candidates for the same selected spec and choosing the single best candidate to apply.

Inputs:

- the selected spec
- the full blinded candidate set
- candidate diffs and supporting artifacts
- any shared run artifacts needed to understand the task context

Expected working style:

1. Read the spec first.
2. Derive the key requirements the run had to satisfy and use stable ids such as \`R1\`, \`R2\`, \`R3\`.
3. Inspect the candidate set directly.
4. Assess each candidate against the verification rubric.
5. Record per-candidate requirement coverage, completion posture, recommendation posture, and bounded follow-up work.
6. Derive a strict best-to-worst ranking from those assessments.
7. Make the ranking strict, complete, and tie-free across the full eligible candidate set.
8. Set \`preferred\` equal to \`ranking[0]\`.

Judgment discipline:

- make claims only when you can point to evidence from candidate diffs or staged files
- if you cannot verify something, say so explicitly
- distinguish cleanup issues from correctness or apply-risk issues
- focus on whether the candidate actually solved the asked task, not whether it merely looks plausible
- focus on bounded, decision-relevant follow-up work
- include lightweight \`evidence_refs\` for each candidate assessment
- keep \`comparison\` focused on cross-candidate tradeoffs such as scope adherence, approach quality, and apply-now cleanliness
- make \`comparison\` explain why \`ranking[0]\` beat \`ranking[1]\`, not just why lower-ranked candidates lost
- include \`next_actions\` only for the selected path

Expected output shape:

- \`assessments[]\` with one entry per candidate
- top-level \`preferred\` naming the selected candidate
- each assessment should include:
  - \`candidate\`
  - \`completion_status\`
  - \`recommendation_level\`
  - \`quality\`
  - \`evaluation\`
  - \`requirements_coverage\`
  - \`implementation_notes\`
  - \`follow_up\`
  - \`evidence_refs\`
- top-level \`comparison\` should capture cross-candidate tradeoffs
- top-level \`ranking\` must be strict, complete, and tie-free
- top-level \`rationale\` should explain why \`preferred\` / \`ranking[0]\` is the best apply choice
- top-level \`next_actions\` should stay short and operational
`,
      rubric: `# Run Review

Review the candidate set by assessing each candidate on:

- spec adherence
- approach
- codebase fit
- apply risk
- evidence

Then derive a final ranking from those assessments.

## Spec Adherence

Ask:

- Does the candidate satisfy the selected spec?
- Are key requirements clearly met, partially met, not met, or not verifiable?
- Are there obvious mismatches between the changed artifacts and the intended outcome?

Spec adherence should dominate elegance or cleanup concerns.

Every candidate assessment should include explicit \`requirements_coverage\` entries so the ranking is traceable back to the asked task rather than inferred from generic quality labels.

## Approach

Ask:

- Does the candidate take the right approach to the task, not just produce a superficially acceptable output?
- Does it avoid scope drift, indirect fixes, or restructuring the task did not ask for?
- Does it create a strong enough foundation without introducing unnecessary complexity?

This is where verification should capture the gap between "passed checks" and "is actually the change we would keep."

## Codebase Fit

Ask:

- Does the implementation fit existing patterns, interfaces, and boundaries?
- Does it look like a coherent extension of the codebase rather than an alien insertion?
- Are migrations, rollbacks, or integration seams well-bounded?

## Apply Risk

Ask:

- What is the likely blast radius of applying this candidate?
- Are there hidden regressions, ambiguous behaviors, or fragile assumptions?
- Are any missing steps or follow-ups bounded and low-risk, or do they open up unbounded uncertainty?

## Evidence

Ask:

- Are important claims supported by concrete artifacts?
- Does the candidate leave meaningful uncertainty unresolved?

Evidence here means direct artifact evidence for the candidate itself:

- diffs
- changed files
- summaries when present
- cited files and line ranges

## Candidate posture

Each candidate assessment should also name:

- \`completion_status\`: \`complete\`, \`complete_with_gap\`, \`complete_with_gaps\`, \`incomplete\`, or \`not_verifiable\`
- \`recommendation_level\`: \`apply_now\`, \`strong_foundation\`, or \`not_recommended\`
- \`quality\`: \`high\`, \`medium\`, or \`low\`

These fields preserve the practical decision posture the current verification artifact captures:

- \`apply_now\` means the candidate is fit to apply without reopening major questions
- \`strong_foundation\` means the candidate is strong but still needs bounded follow-up before it is the cleanest apply choice
- \`not_recommended\` means the candidate should not win the run

## Ranking rule

The final ranking should follow from the candidate assessments above.

It should answer:

- which candidate should win?
- which ordering best reflects apply trustworthiness?

It should not ignore the structured per-candidate assessments.
It must rank the full eligible candidate set with no ties.
Set \`preferred\` equal to \`ranking[0]\`.

The verification artifact should also include:

- \`comparison\`: cross-candidate tradeoffs, explicitly including why \`ranking[0]\` beat \`ranking[1]\`
- \`rationale\`: why \`preferred\` / \`ranking[0]\` is the best choice
- \`next_actions\`: short, operational follow-up for the selected path
`,
      schema: `type: object
required:
  - assessments
  - preferred
  - comparison
  - ranking
  - rationale
  - next_actions
properties:
  assessments:
    type: array
    items:
      type: object
      required:
        - candidate
        - completion_status
        - recommendation_level
        - quality
        - evaluation
        - requirements_coverage
        - implementation_notes
        - follow_up
        - evidence_refs
      properties:
        candidate:
          type: string
        completion_status:
          type: string
          enum: ["complete", "complete_with_gap", "complete_with_gaps", "incomplete", "not_verifiable"]
        recommendation_level:
          type: string
          enum: ["apply_now", "strong_foundation", "not_recommended"]
        quality:
          type: string
          enum: ["high", "medium", "low"]
        evaluation:
          type: object
          required:
            - spec_adherence
            - approach
            - codebase_fit
            - apply_risk
            - evidence
          properties:
            spec_adherence:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            approach:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            codebase_fit:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            apply_risk:
              type: string
              enum: ["low", "medium", "high", "unknown"]
            evidence:
              type: string
              enum: ["strong", "acceptable", "weak", "missing"]
        requirements_coverage:
          type: array
          items:
            type: object
            required:
              - requirement
              - status
              - note
              - evidence_refs
            properties:
              requirement:
                type: string
              status:
                type: string
                enum: ["met", "partial", "not_met", "not_verifiable"]
              note:
                type: string
              evidence_refs:
                type: array
                items:
                  type: string
        implementation_notes:
          type: string
        follow_up:
          type: array
          items:
            type: string
        evidence_refs:
          type: array
          items:
            type: string
  comparison:
    type: string
  preferred:
    type: string
  ranking:
    type: array
    items:
      type: string
  rationale:
    type: string
  next_actions:
    type: array
    items:
      type: string
`,
    },
    {
      name: "reduce-verification",
      prompt: `You are performing reduction verification over a blinded set of reduction candidates for one completed target session.

Your goal is to decide which reduction is the best carry-forward artifact for later use.

Read order:

1. Read the blinded reduction artifacts for all candidates.
2. Compare them on fidelity, usefulness, compression quality, and next-step utility.
3. Produce one structured result that includes per-candidate assessments, a strict full ranking, and an explicit preferred reduction.

What matters:

- preserve important facts from the source session
- remove noise without dropping durable signal
- surface unresolved uncertainty honestly
- preserve the decisions, caveats, and next-step guidance a later operator would actually need
- produce guidance that is actually useful for later \`spec\`, \`run\`, \`reduce\`, or \`verify\` work

What does not matter:

- prose flourish
- maximal detail for its own sake
- ranking a reduction highly just because it is long
- re-litigating the full session when the reduction should carry the durable outcome forward

Do not defer to any one reduction because of agent provenance. Candidates are blinded and should be judged on artifact quality alone.

Ranking requirements:

- rank the full eligible candidate set
- do not use ties
- set \`preferred\` equal to \`ranking[0]\`
- make \`comparison\` explain why \`ranking[0]\` beat \`ranking[1]\`

Expected output shape:

- \`assessments[]\` with one entry per candidate reduction
- each assessment should include:
  - \`candidate\`
  - \`recommendation_level\`
  - \`quality\`
  - \`evaluation\`
  - \`strengths\`
  - \`gaps\`
  - \`evidence_refs\`
- top-level \`preferred\` naming the selected reduction
- top-level \`comparison\` explaining why \`ranking[0]\` beat \`ranking[1]\`
- top-level \`ranking\` must be strict, complete, and tie-free
- top-level \`rationale\` should explain why \`preferred\` is the best carry-forward artifact
- top-level \`next_actions\` should stay short and operational
`,
      rubric: `# Reduce Review Rubric

This rubric answers one question: which reduction is the most useful durable carry-forward artifact?

Evaluate each candidate on:

- fidelity
  - does it preserve the important facts and conclusions from the source session?
- compression
  - does it remove noise without discarding durable signal?
- uncertainty
  - does it preserve unresolved caveats instead of laundering them away?
- next_step_utility
  - would this artifact actually help a later operator or human continue the work without reopening the whole source session?
- evidence
  - are the claims grounded in visible source artifacts?

Recommendation posture:

- carry_forward_now
  - strong enough to use as the preferred reduction artifact immediately
- usable_with_gap
  - useful, but has clear omissions or weaknesses
- not_recommended
  - too lossy, misleading, or weak to be the preferred carry-forward artifact

Comparison guidance:

- prefer durable synthesis over exhaustive recap
- prefer honest uncertainty over false confidence
- prefer actionable carry-forward guidance over generic summary language
- prefer reductions that preserve the session's decisions and caveats, not just its topic area
- do not reward verbosity by default

## Candidate posture

Each candidate assessment should also name:

- \`recommendation_level\`: \`carry_forward_now\`, \`usable_with_gap\`, or \`not_recommended\`
- \`quality\`: \`high\`, \`medium\`, or \`low\`

These fields preserve the practical decision posture a reduction selector needs:

- \`carry_forward_now\` means the reduction is strong enough to use immediately as the preferred carry-forward artifact
- \`usable_with_gap\` means the reduction is directionally useful but has bounded omissions or weaknesses
- \`not_recommended\` means the reduction should not win the stage

Use \`strengths\` and \`gaps\` for per-candidate observations only. Put cross-candidate tradeoffs in \`comparison\` and final winner justification in \`rationale\`.

Ranking rule:

- rank the full eligible candidate set with no ties
- set \`preferred\` equal to \`ranking[0]\`
- make \`comparison\` explain why \`ranking[0]\` beat \`ranking[1]\`

The verification artifact should also include:

- \`comparison\`: cross-candidate tradeoffs, explicitly including why \`ranking[0]\` beat \`ranking[1]\`
- \`rationale\`: why \`preferred\` / \`ranking[0]\` is the best carry-forward choice
- \`next_actions\`: short, operational follow-up for the selected path only
`,
      schema: `type: object
required:
  - assessments
  - preferred
  - comparison
  - ranking
  - rationale
  - next_actions
properties:
  assessments:
    type: array
    items:
      type: object
      required:
        - candidate
        - recommendation_level
        - quality
        - evaluation
        - strengths
        - gaps
        - evidence_refs
      properties:
        candidate:
          type: string
        recommendation_level:
          type: string
          enum: ["carry_forward_now", "usable_with_gap", "not_recommended"]
        quality:
          type: string
          enum: ["high", "medium", "low"]
        evaluation:
          type: object
          required:
            - fidelity
            - compression
            - uncertainty
            - next_step_utility
            - evidence
          properties:
            fidelity:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            compression:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            uncertainty:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            next_step_utility:
              type: string
              enum: ["strong", "acceptable", "weak", "not_verifiable"]
            evidence:
              type: string
              enum: ["strong", "acceptable", "weak", "missing"]
        strengths:
          type: array
          items:
            type: string
        gaps:
          type: array
          items:
            type: string
        evidence_refs:
          type: array
          items:
            type: string
  comparison:
    type: string
  preferred:
    type: string
  ranking:
    type: array
    items:
      type: string
  rationale:
    type: string
  next_actions:
    type: array
    items:
      type: string
`,
    },
  ] as const;
