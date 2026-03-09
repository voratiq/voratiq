import { dirname } from "node:path";

import { CliError } from "../../cli/errors.js";
import { readReductionRecords } from "../../reductions/records/persistence.js";
import {
  type ReductionTarget,
  TERMINAL_REDUCTION_STATUSES,
} from "../../reductions/records/types.js";
import { readReviewRecords } from "../../reviews/records/persistence.js";
import { TERMINAL_REVIEW_STATUSES } from "../../reviews/records/types.js";
import { buildRunRecordView } from "../../runs/records/enhanced.js";
import { RunRecordNotFoundError } from "../../runs/records/errors.js";
import { fetchRunsSafely } from "../../runs/records/persistence.js";
import { readSpecRecords } from "../../specs/records/persistence.js";
import { TERMINAL_SPEC_STATUSES } from "../../specs/records/types.js";
import { type RunStatus, TERMINAL_RUN_STATUSES } from "../../status/index.js";
import { pathExists } from "../../utils/fs.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import {
  REDUCTION_DATA_FILENAME,
  REVIEW_RECOMMENDATION_FILENAME,
} from "../../workspace/structure.js";
import { RunNotFoundCliError } from "../errors.js";

export interface ReductionTargetValidationInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reviewsFilePath: string;
  reductionsFilePath: string;
  target: ReductionTarget;
}

export async function assertReductionTargetEligible(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { target } = input;

  switch (target.type) {
    case "spec":
      await assertSpecTargetEligible(input);
      return;
    case "run":
      await assertRunTargetEligible(input);
      return;
    case "review":
      await assertReviewTargetEligible(input);
      return;
    case "reduction":
      await assertReductionTargetEligibleInternal(input);
      return;
  }
}

async function assertSpecTargetEligible(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { root, specsFilePath, target } = input;

  const [record] = await readSpecRecords({
    root,
    specsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });

  if (!record) {
    throw new CliError(
      `Spec session \`${target.id}\` not found.`,
      [],
      [
        "Re-run `voratiq spec` or confirm the session id in `.voratiq/specs/index.json`.",
      ],
    );
  }

  if (!TERMINAL_SPEC_STATUSES.includes(record.status)) {
    throw new CliError(
      `Spec session \`${target.id}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the spec to finish or re-run `voratiq spec`."],
    );
  }

  if (record.status !== "saved") {
    throw new CliError(
      `Spec session \`${target.id}\` did not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq spec` to generate a complete spec artifact."],
    );
  }

  const outputAbsolute = resolvePath(root, record.outputPath);
  if (!(await pathExists(outputAbsolute))) {
    throw new CliError(
      `Spec session \`${target.id}\` is missing its output file.`,
      [`Expected: \`${normalizePathForDisplay(record.outputPath)}\`.`],
      ["Re-run `voratiq spec` to regenerate the spec artifact."],
    );
  }
}

async function assertRunTargetEligible(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { root, runsFilePath, target } = input;

  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId: target.id,
    filters: { includeDeleted: true },
  }).catch((error) => {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunNotFoundCliError(target.id);
    }
    throw error;
  });

  const record = records[0];
  if (!record) {
    throw new RunNotFoundCliError(target.id);
  }

  if (record.deletedAt) {
    throw new CliError(
      `Run \`${target.id}\` has been pruned.`,
      [],
      ["Re-run `voratiq run` to regenerate artifacts."],
    );
  }

  if (!TERMINAL_RUN_STATUSES.includes(record.status)) {
    throw new CliError(
      `Run \`${target.id}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the run to finish before reducing."],
    );
  }

  if (record.status === "aborted") {
    throw new CliError(
      `Run \`${target.id}\` did not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq run` to generate a complete artifact set."],
    );
  }

  assertRunArtifactsPresent(record.status, target.id);

  const enhanced = await buildRunRecordView(record, { workspaceRoot: root });
  const missing = await findMissingRunArtifacts(root, enhanced);
  if (missing.length > 0) {
    throw new CliError(
      `Run \`${target.id}\` is missing required artifacts.`,
      missing.map((path) => `Missing: \`${path}\`.`),
      ["Re-run `voratiq run` to regenerate the run artifacts."],
    );
  }
}

function assertRunArtifactsPresent(status: RunStatus, runId: string): void {
  if (status === "succeeded" || status === "failed" || status === "errored") {
    return;
  }

  throw new CliError(
    `Run \`${runId}\` is not eligible for reduction.`,
    [`Status: \`${status}\`.`],
    ["Re-run `voratiq run` to generate a complete artifact set."],
  );
}

async function assertReviewTargetEligible(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { root, reviewsFilePath, target } = input;

  const [record] = await readReviewRecords({
    root,
    reviewsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });

  if (!record) {
    throw new CliError(
      `Review session \`${target.id}\` not found.`,
      [],
      [
        "Re-run `voratiq review` or confirm the session id in `.voratiq/reviews/index.json`.",
      ],
    );
  }

  if (!TERMINAL_REVIEW_STATUSES.includes(record.status)) {
    throw new CliError(
      `Review session \`${target.id}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the review to finish or re-run `voratiq review`."],
    );
  }

  if (record.status !== "succeeded") {
    throw new CliError(
      `Review session \`${target.id}\` did not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq review` to generate a complete artifact set."],
    );
  }

  const missing = await findMissingReviewArtifacts(root, record.reviewers);
  if (missing.length > 0) {
    throw new CliError(
      `Review session \`${target.id}\` is missing required artifacts.`,
      missing.map((path) => `Missing: \`${path}\`.`),
      ["Re-run `voratiq review` to regenerate review artifacts."],
    );
  }
}

async function assertReductionTargetEligibleInternal(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { root, reductionsFilePath, target } = input;

  if (!(await pathExists(reductionsFilePath))) {
    throw new CliError(
      `Reduction session \`${target.id}\` not found.`,
      [],
      ["Confirm the session id in `.voratiq/reductions/index.json`."],
    );
  }

  const [record] = await readReductionRecords({
    root,
    reductionsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });

  if (!record) {
    throw new CliError(
      `Reduction session \`${target.id}\` not found.`,
      [],
      ["Confirm the session id in `.voratiq/reductions/index.json`."],
    );
  }

  if (!TERMINAL_REDUCTION_STATUSES.includes(record.status)) {
    throw new CliError(
      `Reduction session \`${target.id}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the reduction to finish before reducing."],
    );
  }

  if (record.status !== "succeeded") {
    throw new CliError(
      `Reduction session \`${target.id}\` did not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq reduce` to generate a complete artifact set."],
    );
  }

  const missing = await findMissingReductionArtifacts(root, record.reducers);
  if (missing.length > 0) {
    throw new CliError(
      `Reduction session \`${target.id}\` is missing required artifacts.`,
      missing.map((path) => `Missing: \`${path}\`.`),
      ["Re-run `voratiq reduce` to regenerate reduction artifacts."],
    );
  }
}

async function findMissingReviewArtifacts(
  root: string,
  reviewers: ReadonlyArray<{ outputPath: string }>,
): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const reviewer of reviewers) {
    const reviewPath = reviewer.outputPath;
    const reviewAbsolute = resolvePath(root, reviewPath);
    if (!(await pathExists(reviewAbsolute))) {
      registerMissing(missing, seen, reviewPath);
    }

    const recommendationPath = normalizePathForDisplay(
      relativeToRoot(
        root,
        resolvePath(root, dirname(reviewPath), REVIEW_RECOMMENDATION_FILENAME),
      ),
    );
    const recommendationAbsolute = resolvePath(root, recommendationPath);
    if (!(await pathExists(recommendationAbsolute))) {
      registerMissing(missing, seen, recommendationPath);
    }
  }

  return missing;
}

async function findMissingReductionArtifacts(
  root: string,
  reducers: ReadonlyArray<{ outputPath: string; dataPath?: string }>,
): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const reducer of reducers) {
    const outputPath = reducer.outputPath;
    const outputAbsolute = resolvePath(root, outputPath);
    if (!(await pathExists(outputAbsolute))) {
      registerMissing(missing, seen, outputPath);
    }

    const dataPath =
      reducer.dataPath ??
      normalizePathForDisplay(
        relativeToRoot(
          root,
          resolvePath(root, dirname(outputPath), REDUCTION_DATA_FILENAME),
        ),
      );
    const dataAbsolute = resolvePath(root, dataPath);
    if (!(await pathExists(dataAbsolute))) {
      registerMissing(missing, seen, dataPath);
    }
  }

  return missing;
}

async function findMissingRunArtifacts(
  root: string,
  run: Awaited<ReturnType<typeof buildRunRecordView>>,
): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  const specAbsolute = resolvePath(root, run.spec.path);
  if (!(await pathExists(specAbsolute))) {
    registerMissing(missing, seen, normalizePathForDisplay(run.spec.path));
  }

  for (const agent of run.agents) {
    const candidatePaths = [agent.assets.diffPath, agent.assets.summaryPath];
    for (const candidatePath of candidatePaths) {
      if (!candidatePath) {
        continue;
      }
      const absolute = resolvePath(root, candidatePath);
      if (!(await pathExists(absolute))) {
        registerMissing(missing, seen, normalizePathForDisplay(candidatePath));
      }
    }
  }

  return missing;
}

function registerMissing(
  missing: string[],
  seen: Set<string>,
  path: string,
): void {
  if (seen.has(path)) {
    return;
  }
  seen.add(path);
  missing.push(path);
}
