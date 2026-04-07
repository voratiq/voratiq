import { dirname } from "node:path";

import { CliError } from "../../cli/errors.js";
import { RunNotFoundCliError } from "../../cli/errors.js";
import { TERMINAL_MESSAGE_STATUSES } from "../../domain/message/model/types.js";
import { readMessageRecords } from "../../domain/message/persistence/adapter.js";
import {
  type ReductionTarget,
  TERMINAL_REDUCTION_STATUSES,
} from "../../domain/reduce/model/types.js";
import { readReductionRecords } from "../../domain/reduce/persistence/adapter.js";
import { buildRunRecordView } from "../../domain/run/model/enhanced.js";
import { RunRecordNotFoundError } from "../../domain/run/model/errors.js";
import type { RunRecord } from "../../domain/run/model/types.js";
import { fetchRunsSafely } from "../../domain/run/persistence/adapter.js";
import { TERMINAL_SPEC_STATUSES } from "../../domain/spec/model/types.js";
import { readSpecRecords } from "../../domain/spec/persistence/adapter.js";
import { TERMINAL_VERIFICATION_STATUSES } from "../../domain/verify/model/types.js";
import { readVerificationRecords } from "../../domain/verify/persistence/adapter.js";
import { TERMINAL_RUN_STATUSES } from "../../status/index.js";
import { pathExists } from "../../utils/fs.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import { REDUCTION_DATA_FILENAME } from "../../workspace/structure.js";

export interface ReductionTargetValidationInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
  verificationsFilePath: string;
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
    case "reduce":
      await assertReductionTargetEligibleInternal(input);
      return;
    case "verify":
      await assertVerificationTargetEligible(input);
      return;
    case "message":
      await assertMessageTargetEligible(input);
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
        "Re-run `voratiq spec` or confirm the session id in `.voratiq/spec/index.json`.",
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

  if (record.status !== "succeeded") {
    throw new CliError(
      `Spec session \`${target.id}\` did not succeed.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq spec` to generate a complete spec artifact."],
    );
  }

  const generatedAgents = record.agents.filter(
    (agent) =>
      agent.status === "succeeded" && agent.outputPath && agent.dataPath,
  );
  if (generatedAgents.length === 0) {
    throw new CliError(
      `Spec session \`${target.id}\` has no complete generated artifacts.`,
      [],
      ["Re-run `voratiq spec` to regenerate the spec artifacts."],
    );
  }

  const missing: string[] = [];
  for (const agent of generatedAgents) {
    if (!agent.outputPath || !agent.dataPath) continue;
    const markdownAbsolute = resolvePath(root, agent.outputPath);
    if (!(await pathExists(markdownAbsolute))) {
      missing.push(normalizePathForDisplay(agent.outputPath));
    }
    const dataAbsolute = resolvePath(root, agent.dataPath);
    if (!(await pathExists(dataAbsolute))) {
      missing.push(normalizePathForDisplay(agent.dataPath));
    }
  }
  if (missing.length > 0) {
    throw new CliError(
      `Spec session \`${target.id}\` is missing artifact files.`,
      missing.map((path) => `Missing: \`${path}\`.`),
      ["Re-run `voratiq spec` to regenerate the spec artifacts."],
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

  if (!isRunStatusCompleteForReduction(record.status)) {
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

function isRunStatusCompleteForReduction(status: RunRecord["status"]): boolean {
  return status === "pruned" || TERMINAL_RUN_STATUSES.includes(status);
}

function assertRunArtifactsPresent(
  status: RunRecord["status"],
  runId: string,
): void {
  if (
    status === "succeeded" ||
    status === "failed" ||
    status === "errored" ||
    status === "pruned"
  ) {
    return;
  }

  throw new CliError(
    `Run \`${runId}\` is not eligible for reduction.`,
    [`Status: \`${status}\`.`],
    ["Re-run `voratiq run` to generate a complete artifact set."],
  );
}

async function assertVerificationTargetEligible(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { root, verificationsFilePath, target } = input;

  const [record] = await readVerificationRecords({
    root,
    verificationsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });

  if (!record) {
    throw new CliError(
      `Verification session \`${target.id}\` not found.`,
      [],
      [
        "Re-run `voratiq verify` or confirm the session id in `.voratiq/verify/index.json`.",
      ],
    );
  }

  if (!TERMINAL_VERIFICATION_STATUSES.includes(record.status)) {
    throw new CliError(
      `Verification session \`${target.id}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the verification to finish or re-run `voratiq verify`."],
    );
  }

  if (record.status === "aborted") {
    throw new CliError(
      `Verification session \`${target.id}\` did not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq verify` to generate a complete artifact set."],
    );
  }

  const missing = await findMissingVerificationArtifacts(root, record.methods);
  if (missing.length > 0) {
    throw new CliError(
      `Verification session \`${target.id}\` is missing required artifacts.`,
      missing.map((path) => `Missing: \`${path}\`.`),
      ["Re-run `voratiq verify` to regenerate verification artifacts."],
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
      ["Confirm the session id in `.voratiq/reduce/index.json`."],
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
      ["Confirm the session id in `.voratiq/reduce/index.json`."],
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

async function assertMessageTargetEligible(
  input: ReductionTargetValidationInput,
): Promise<void> {
  const { root, messagesFilePath, target } = input;

  const [record] = await readMessageRecords({
    root,
    messagesFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });

  if (!record) {
    throw new CliError(
      `Message session \`${target.id}\` not found.`,
      [],
      [
        "Re-run `voratiq message` or confirm the session id in `.voratiq/message/index.json`.",
      ],
    );
  }

  if (!TERMINAL_MESSAGE_STATUSES.includes(record.status)) {
    throw new CliError(
      `Message session \`${target.id}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the message to finish before reducing."],
    );
  }

  if (record.status !== "succeeded") {
    throw new CliError(
      `Message session \`${target.id}\` did not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Re-run `voratiq message` to generate a complete artifact set."],
    );
  }

  const generatedRecipients = record.recipients.filter(
    (recipient): recipient is typeof recipient & { outputPath: string } =>
      recipient.status === "succeeded" &&
      typeof recipient.outputPath === "string",
  );
  if (generatedRecipients.length === 0) {
    throw new CliError(
      `Message session \`${target.id}\` has no generated artifacts.`,
      [],
      ["Re-run `voratiq message` to regenerate the message artifacts."],
    );
  }

  const missing = await findMissingMessageArtifacts(root, generatedRecipients);
  if (missing.length > 0) {
    throw new CliError(
      `Message session \`${target.id}\` is missing required artifacts.`,
      missing.map((path) => `Missing: \`${path}\`.`),
      ["Re-run `voratiq message` to regenerate the message artifacts."],
    );
  }
}

async function findMissingVerificationArtifacts(
  root: string,
  methods: ReadonlyArray<{ artifactPath?: string }>,
): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const method of methods) {
    if (!method.artifactPath) {
      continue;
    }
    const artifactPath = normalizePathForDisplay(method.artifactPath);
    const artifactAbsolute = resolvePath(root, artifactPath);
    if (!(await pathExists(artifactAbsolute))) {
      registerMissing(missing, seen, artifactPath);
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

async function findMissingMessageArtifacts(
  root: string,
  recipients: ReadonlyArray<{ outputPath: string }>,
): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const recipient of recipients) {
    const outputPath = recipient.outputPath;
    const outputAbsolute = resolvePath(root, outputPath);
    if (!(await pathExists(outputAbsolute))) {
      registerMissing(missing, seen, outputPath);
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
