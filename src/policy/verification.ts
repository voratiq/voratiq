import { readFile } from "node:fs/promises";

import type { ProgrammaticCheckResult } from "../configs/verification/methods.js";
import type {
  ProgrammaticResultArtifact,
  RubricResultArtifact,
  RubricResultPayload,
  VerificationMethodResultRef,
  VerificationRecord,
  VerificationTarget,
} from "../domain/verify/model/types.js";
import {
  programmaticResultArtifactSchema,
  rubricResultArtifactSchema,
} from "../domain/verify/model/types.js";
import {
  readRubricResultPreferred,
  readRubricResultRanking,
} from "../domain/verify/rubric-result.js";
import { resolvePath } from "../utils/path.js";
import { resolveCanonicalAgentId } from "./resolution.js";
import {
  buildResolvableSelectionDecision,
  buildUnresolvedSelectionDecision,
  type SelectionDecision,
} from "./result.js";
import type { SelectorResolutionSourceInput } from "./selector.js";
import type { VerifierSelectionReviewerInput } from "./verifier-selection.js";
import { deriveVerifierSelectionDecision } from "./verifier-selection.js";

export interface VerificationPolicyProgrammaticCandidateInput {
  candidateId: string;
  results: readonly ProgrammaticCheckResult[];
}

export type VerificationPolicyProgrammaticInput =
  | {
      artifactPath: string;
      scope: "target";
      results: readonly ProgrammaticCheckResult[];
    }
  | {
      artifactPath: string;
      scope: "run";
      candidates: readonly VerificationPolicyProgrammaticCandidateInput[];
    };

export interface VerificationPolicyRubricInput {
  artifactPath: string;
  template: string;
  verifierId: string;
  status: VerificationMethodResultRef["status"];
  result: RubricResultPayload;
  error?: string | null;
}

export interface VerificationPolicyInput {
  sessionId: string;
  target: VerificationTarget;
  blinded?: VerificationRecord["blinded"];
  programmatic?: VerificationPolicyProgrammaticInput;
  rubrics: readonly VerificationPolicyRubricInput[];
}

export interface VerificationSelectionProgrammaticCandidateInput {
  candidateId: string;
  results: readonly ProgrammaticCheckResult[];
  passing: boolean;
}

export interface VerificationSelectionInput {
  sessionId: string;
  target: VerificationTarget;
  canonicalCandidateIds: readonly string[];
  blindedAliasMap?: NonNullable<VerificationRecord["blinded"]>["aliasMap"];
  verifiers: readonly VerifierSelectionReviewerInput[];
  programmatic?: {
    candidates: readonly VerificationSelectionProgrammaticCandidateInput[];
  };
}

export interface VerificationSelectionPolicyOutput {
  input: VerificationSelectionInput;
  decision: SelectionDecision;
}

export async function loadVerificationPolicyInput(options: {
  root: string;
  record: VerificationRecord;
}): Promise<VerificationPolicyInput> {
  const { root, record } = options;
  const artifactCache = new Map<string, unknown>();
  let programmatic: VerificationPolicyProgrammaticInput | undefined;
  const rubrics: VerificationPolicyRubricInput[] = [];

  for (const method of record.methods) {
    if (!method.artifactPath) {
      continue;
    }

    if (method.method === "programmatic") {
      const artifact = await readProgrammaticArtifact({
        root,
        artifactPath: method.artifactPath,
        cache: artifactCache,
      });
      assertProgrammaticArtifactMatchesRef(record, method, artifact);
      programmatic =
        artifact.scope === "target"
          ? {
              artifactPath: method.artifactPath,
              scope: "target",
              results: artifact.results,
            }
          : {
              artifactPath: method.artifactPath,
              scope: "run",
              candidates: artifact.candidates,
            };
      continue;
    }

    const artifact = await readRubricArtifact({
      root,
      artifactPath: method.artifactPath,
      cache: artifactCache,
    });
    assertRubricArtifactMatchesRef(record, method, artifact);
    rubrics.push({
      artifactPath: method.artifactPath,
      template: artifact.template,
      verifierId: artifact.verifierId,
      status: artifact.status,
      result: artifact.result,
      error: artifact.error,
    });
  }

  return {
    sessionId: record.sessionId,
    target: record.target,
    ...(record.blinded ? { blinded: record.blinded } : {}),
    ...(programmatic ? { programmatic } : {}),
    rubrics,
  };
}

export async function loadVerificationSelectionInput(options: {
  root: string;
  record: VerificationRecord;
  canonicalCandidateIds?: readonly string[];
}): Promise<VerificationSelectionInput> {
  const { record } = options;
  const policyInput = await loadVerificationPolicyInput(options);
  const verifiers = buildVerificationSelectionVerifiers(policyInput);
  const canonicalCandidateIds = resolveCanonicalCandidateIds({
    record,
    providedCanonicalCandidateIds: options.canonicalCandidateIds,
    policyInput,
    verifiers,
  });

  return {
    sessionId: policyInput.sessionId,
    target: policyInput.target,
    canonicalCandidateIds,
    ...(policyInput.blinded?.aliasMap
      ? { blindedAliasMap: policyInput.blinded.aliasMap }
      : {}),
    verifiers: verifiers.map((verifier) =>
      verifier.status === "failed"
        ? verifier
        : {
            ...verifier,
            resolvedPreferredCandidateId: resolveCanonicalAgentId({
              selectors: [
                verifier.resolvedPreferredCandidateId,
                verifier.preferredCandidateId,
              ],
              canonicalAgentIds: canonicalCandidateIds,
              aliasMap: policyInput.blinded?.aliasMap,
            }),
          },
    ),
    ...(policyInput.programmatic?.scope === "run"
      ? {
          programmatic: {
            candidates: policyInput.programmatic.candidates.map(
              (candidate) => ({
                candidateId: candidate.candidateId,
                results: candidate.results,
                passing: candidate.results.every(isPassingProgrammaticResult),
              }),
            ),
          },
        }
      : {}),
  };
}

export async function loadVerificationSelectionPolicyOutput(options: {
  root: string;
  record: VerificationRecord;
  canonicalCandidateIds?: readonly string[];
}): Promise<VerificationSelectionPolicyOutput> {
  const input = await loadVerificationSelectionInput(options);
  return {
    input,
    decision: deriveVerificationSelectionDecision(input),
  };
}

export function deriveVerificationSelectionDecision(
  input: VerificationSelectionInput,
): SelectionDecision {
  const eligibleCanonicalAgentIds = resolveEligibleCanonicalAgentIds(input);

  if (input.programmatic && eligibleCanonicalAgentIds.length === 0) {
    return buildUnresolvedSelectionDecision([
      {
        code: "no_programmatic_candidates_passed",
        candidateIds: [...input.canonicalCandidateIds],
      },
    ]);
  }

  if (input.verifiers.length > 0) {
    const rubricDecision = deriveVerifierSelectionDecision({
      canonicalAgentIds: input.canonicalCandidateIds,
      verifiers: input.verifiers,
    });
    if (rubricDecision.state === "unresolved") {
      return rubricDecision;
    }

    if (
      input.programmatic &&
      !eligibleCanonicalAgentIds.includes(
        rubricDecision.selectedCanonicalAgentId,
      )
    ) {
      return buildUnresolvedSelectionDecision([
        {
          code: "selected_candidate_failed_programmatic",
          selectedCanonicalAgentId: rubricDecision.selectedCanonicalAgentId,
          eligibleCanonicalAgentIds,
        },
      ]);
    }

    return rubricDecision;
  }

  if (eligibleCanonicalAgentIds.length === 1) {
    return buildResolvableSelectionDecision(eligibleCanonicalAgentIds[0] ?? "");
  }

  if (eligibleCanonicalAgentIds.length > 1) {
    return buildUnresolvedSelectionDecision([
      {
        code: "multiple_programmatic_candidates_passed",
        eligibleCanonicalAgentIds,
      },
    ]);
  }

  return buildUnresolvedSelectionDecision([
    {
      code: "no_successful_verifiers",
      failedVerifierAgentIds: [],
    },
  ]);
}

export function buildVerificationSelectorSource(
  output: VerificationSelectionPolicyOutput,
): SelectorResolutionSourceInput | undefined {
  if (!output.input.blindedAliasMap) {
    return undefined;
  }

  return {
    sourceId: output.input.sessionId,
    aliasMap: output.input.blindedAliasMap,
  };
}

async function readProgrammaticArtifact(options: {
  root: string;
  artifactPath: string;
  cache: Map<string, unknown>;
}): Promise<ProgrammaticResultArtifact> {
  const { artifactPath } = options;
  const cached = await readArtifactJson(options);
  const result = programmaticResultArtifactSchema.safeParse(cached);
  if (!result.success) {
    throw new Error(
      `Invalid verification artifact \`${artifactPath}\`: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

async function readRubricArtifact(options: {
  root: string;
  artifactPath: string;
  cache: Map<string, unknown>;
}): Promise<RubricResultArtifact> {
  const { artifactPath } = options;
  const cached = await readArtifactJson(options);
  const result = rubricResultArtifactSchema.safeParse(cached);
  if (!result.success) {
    throw new Error(
      `Invalid verification artifact \`${artifactPath}\`: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

async function readArtifactJson(options: {
  root: string;
  artifactPath: string;
  cache: Map<string, unknown>;
}): Promise<unknown> {
  const { root, artifactPath, cache } = options;
  const cached = cache.get(artifactPath);
  if (cached !== undefined) {
    return cached;
  }

  const absolutePath = resolvePath(root, artifactPath);
  const raw = await readFile(absolutePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(
      `Invalid verification artifact \`${artifactPath}\`: ${reason}`,
    );
  }
  cache.set(artifactPath, parsed);
  return parsed;
}

function buildVerificationSelectionVerifiers(
  policyInput: VerificationPolicyInput,
): VerifierSelectionReviewerInput[] {
  return policyInput.rubrics.map((rubric) => {
    if (rubric.status !== "succeeded") {
      return {
        verifierAgentId: rubric.verifierId,
        status: "failed" as const,
      };
    }

    const preferredCandidateId =
      readRubricResultPreferred(rubric.result) ??
      readRubricResultRanking(rubric.result)?.[0];

    return {
      verifierAgentId: rubric.verifierId,
      status: "succeeded" as const,
      ...(preferredCandidateId ? { preferredCandidateId } : {}),
    };
  });
}

function resolveCanonicalCandidateIds(options: {
  record: VerificationRecord;
  providedCanonicalCandidateIds?: readonly string[];
  policyInput: VerificationPolicyInput;
  verifiers: readonly VerifierSelectionReviewerInput[];
}): string[] {
  const { record, providedCanonicalCandidateIds, policyInput, verifiers } =
    options;
  if (record.target.kind === "run") {
    return [...record.target.candidateIds];
  }

  const candidateIds = new Set<string>(providedCanonicalCandidateIds ?? []);

  for (const candidateId of Object.values(
    policyInput.blinded?.aliasMap ?? {},
  )) {
    candidateIds.add(candidateId);
  }

  if (candidateIds.size === 0) {
    for (const verifier of verifiers) {
      if (verifier.preferredCandidateId) {
        candidateIds.add(verifier.preferredCandidateId);
      }
      if (verifier.resolvedPreferredCandidateId) {
        candidateIds.add(verifier.resolvedPreferredCandidateId);
      }
    }
  }

  return Array.from(candidateIds.values()).sort((left, right) =>
    left.localeCompare(right),
  );
}

function resolveEligibleCanonicalAgentIds(
  input: VerificationSelectionInput,
): string[] {
  if (!input.programmatic) {
    return [...input.canonicalCandidateIds];
  }

  const eligibleCanonicalAgentIds = input.programmatic.candidates
    .filter((candidate) => candidate.passing)
    .map((candidate) => candidate.candidateId)
    .filter((candidateId) => input.canonicalCandidateIds.includes(candidateId));

  return Array.from(new Set(eligibleCanonicalAgentIds)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function isPassingProgrammaticResult(result: ProgrammaticCheckResult): boolean {
  return result.status === "succeeded" || result.status === "skipped";
}

function assertProgrammaticArtifactMatchesRef(
  record: VerificationRecord,
  method: VerificationMethodResultRef,
  artifact: ProgrammaticResultArtifact,
): void {
  if (artifact.method !== "programmatic") {
    throw new Error(
      `Verification artifact \`${method.artifactPath}\` does not contain a programmatic result`,
    );
  }

  assertTargetsMatch(record.target, artifact.target, method.artifactPath ?? "");

  if (record.target.kind === "run" && artifact.scope !== "run") {
    throw new Error(
      `Run verification artifact \`${method.artifactPath}\` must use scope \`run\``,
    );
  }

  if (record.target.kind !== "run" && artifact.scope !== "target") {
    throw new Error(
      `Non-run verification artifact \`${method.artifactPath}\` must use scope \`target\``,
    );
  }
}

function assertRubricArtifactMatchesRef(
  record: VerificationRecord,
  method: VerificationMethodResultRef,
  artifact: RubricResultArtifact,
): void {
  const artifactPath = method.artifactPath ?? "";

  if (artifact.verifierId !== method.verifierId) {
    throw new Error(
      `Verification artifact \`${artifactPath}\` verifier mismatch: expected \`${method.verifierId}\`, received \`${artifact.verifierId}\``,
    );
  }
  if (artifact.template !== method.template) {
    throw new Error(
      `Verification artifact \`${artifactPath}\` template mismatch: expected \`${method.template}\`, received \`${artifact.template}\``,
    );
  }

  assertBlindedRubricRecommendationSelectors({
    artifactPath,
    result: artifact.result,
    aliasMap: record.blinded?.aliasMap,
  });
}

function assertTargetsMatch(
  expected: VerificationTarget,
  actual: VerificationTarget,
  artifactPath: string,
): void {
  if (
    expected.kind !== actual.kind ||
    expected.sessionId !== actual.sessionId
  ) {
    throw new Error(
      `Verification artifact \`${artifactPath}\` target mismatch`,
    );
  }

  if (expected.kind === "run") {
    const expectedCandidates = [...expected.candidateIds].sort();
    const actualCandidates =
      actual.kind === "run" ? [...actual.candidateIds].sort() : [];
    if (
      expectedCandidates.length !== actualCandidates.length ||
      expectedCandidates.some(
        (candidateId, index) => candidateId !== actualCandidates[index],
      )
    ) {
      throw new Error(
        `Verification artifact \`${artifactPath}\` candidate set mismatch`,
      );
    }
  }
}

function formatZodIssues(
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>,
): string {
  return issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function assertBlindedRubricRecommendationSelectors(options: {
  artifactPath: string;
  result: RubricResultPayload;
  aliasMap?: Record<string, string>;
}): void {
  const { artifactPath, result, aliasMap } = options;
  if (!aliasMap) {
    return;
  }

  const unknownSelectors = new Set<string>();
  const preferred = readRubricResultPreferred(result);
  if (preferred && !aliasMap[preferred]) {
    unknownSelectors.add(preferred);
  }

  for (const selector of readRubricResultRanking(result) ?? []) {
    if (!aliasMap[selector]) {
      unknownSelectors.add(selector);
    }
  }

  if (unknownSelectors.size === 0) {
    return;
  }

  const details = Array.from(unknownSelectors)
    .sort((left, right) => left.localeCompare(right))
    .map((selector) => `\`${selector}\``)
    .join(", ");
  throw new Error(
    `Verification artifact \`${artifactPath}\` contains unknown blinded selector(s): ${details}`,
  );
}
