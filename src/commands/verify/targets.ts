import { basename } from "node:path";

import { CliError, RunNotFoundCliError } from "../../cli/errors.js";
import { TERMINAL_MESSAGE_STATUSES } from "../../domain/message/model/types.js";
import { readMessageRecords } from "../../domain/message/persistence/adapter.js";
import type { ReductionRecord } from "../../domain/reduce/model/types.js";
import { TERMINAL_REDUCTION_STATUSES } from "../../domain/reduce/model/types.js";
import { readReductionRecords } from "../../domain/reduce/persistence/adapter.js";
import { RunRecordNotFoundError } from "../../domain/run/model/errors.js";
import type { RunRecord } from "../../domain/run/model/types.js";
import { fetchRunsSafely } from "../../domain/run/persistence/adapter.js";
import type { SpecRecord } from "../../domain/spec/model/types.js";
import { TERMINAL_SPEC_STATUSES } from "../../domain/spec/model/types.js";
import { readSpecRecords } from "../../domain/spec/persistence/adapter.js";
import type {
  ResolvedVerificationTarget,
  VerificationCompetitiveCandidate,
} from "../../domain/verify/competition/target.js";
import { readVerificationRecords } from "../../domain/verify/persistence/adapter.js";
import { TERMINAL_RUN_STATUSES } from "../../status/index.js";
import { MESSAGE_RESPONSE_FILENAME } from "../../workspace/structure.js";

export type VerifyTargetKind = "spec" | "run" | "reduce" | "message";

export interface VerifyTargetSelection {
  kind: VerifyTargetKind;
  sessionId: string;
}

export interface ResolveVerifyTargetInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
  verificationsFilePath: string;
  target: VerifyTargetSelection;
}

export type VerifyCompetitiveCandidate = VerificationCompetitiveCandidate;

export type ResolvedVerifyTarget = ResolvedVerificationTarget;

export async function resolveVerifyTarget(
  input: ResolveVerifyTargetInput,
): Promise<ResolvedVerifyTarget> {
  const { target } = input;

  switch (target.kind) {
    case "spec":
      return resolveSpecVerifyTarget(input);
    case "run":
      return resolveRunVerifyTarget(input);
    case "reduce":
      return resolveReductionVerifyTarget(input);
    case "message":
      return resolveMessageVerifyTarget(input);
  }
}

async function resolveSpecVerifyTarget(
  input: ResolveVerifyTargetInput,
): Promise<ResolvedVerifyTarget> {
  const { root, specsFilePath, target } = input;

  const [record] = await readSpecRecords({
    root,
    specsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.sessionId,
  });

  if (!record) {
    throw new CliError(
      `Spec session \`${target.sessionId}\` not found.`,
      [],
      [
        "Re-run `voratiq spec` or confirm the session id in `.voratiq/spec/index.json`.",
      ],
    );
  }

  if (!TERMINAL_SPEC_STATUSES.includes(record.status)) {
    throw new CliError(
      `Spec session \`${target.sessionId}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the spec to finish before running `voratiq verify`."],
    );
  }

  return {
    baseRevisionSha: resolveSpecBaseRevisionSha(record),
    competitiveCandidates: record.agents
      .filter((agent) => agent.status === "succeeded" && agent.outputPath)
      .map((agent) => ({
        canonicalId: agent.agentId,
        forbiddenIdentityTokens: [agent.agentId],
      })),
    target: {
      kind: "spec",
      sessionId: record.sessionId,
    },
    specRecord: record,
  };
}

async function resolveRunVerifyTarget(
  input: ResolveVerifyTargetInput,
): Promise<ResolvedVerifyTarget> {
  const { root, runsFilePath, target } = input;

  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId: target.sessionId,
    filters: { includeDeleted: true },
  }).catch((error) => {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunNotFoundCliError(target.sessionId);
    }
    throw error;
  });

  const record = records[0];
  if (!record) {
    throw new RunNotFoundCliError(target.sessionId);
  }

  if (!isRunStatusCompleteForVerification(record.status)) {
    throw new CliError(
      `Run \`${target.sessionId}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the run to finish before running `voratiq verify`."],
    );
  }

  const candidateIds = [
    ...new Set(record.agents.map((agent) => agent.agentId)),
  ].sort((left, right) => left.localeCompare(right));

  if (candidateIds.length === 0) {
    throw new CliError(
      `Run \`${target.sessionId}\` has no candidate agents to verify.`,
      [],
      ["Re-run `voratiq run` to generate verifiable candidates."],
    );
  }

  return {
    baseRevisionSha: record.baseRevisionSha,
    competitiveCandidates: candidateIds.map((candidateId) => ({
      canonicalId: candidateId,
      forbiddenIdentityTokens: collectRunCandidateIdentityTokens({
        runRecord: record,
        candidateId,
      }),
    })),
    target: {
      kind: "run",
      sessionId: record.runId,
      candidateIds,
    },
    runRecord: record,
  };
}

function isRunStatusCompleteForVerification(
  status: RunRecord["status"],
): boolean {
  return status === "pruned" || TERMINAL_RUN_STATUSES.includes(status);
}

async function resolveReductionVerifyTarget(
  input: ResolveVerifyTargetInput,
): Promise<ResolvedVerifyTarget> {
  const { root, reductionsFilePath, target } = input;

  const [record] = await readReductionRecords({
    root,
    reductionsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.sessionId,
  });

  if (!record) {
    throw new CliError(
      `Reduction session \`${target.sessionId}\` not found.`,
      [],
      [
        "Re-run `voratiq reduce` or confirm the session id in `.voratiq/reduce/index.json`.",
      ],
    );
  }

  if (!TERMINAL_REDUCTION_STATUSES.includes(record.status)) {
    throw new CliError(
      `Reduction session \`${target.sessionId}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      ["Wait for the reduction to finish before running `voratiq verify`."],
    );
  }

  const referenceRepo = await resolveReductionReferenceRepo({
    ...input,
    reductionRecord: record,
  });
  const competitiveCandidates = record.reducers
    .filter((reducer) => reducer.status === "succeeded" && reducer.outputPath)
    .map((reducer) => ({
      canonicalId: reducer.agentId,
      forbiddenIdentityTokens: [reducer.agentId],
    }));

  if (referenceRepo.kind === "git") {
    return {
      baseRevisionSha: referenceRepo.baseRevisionSha,
      competitiveCandidates,
      target: {
        kind: "reduce",
        sessionId: record.sessionId,
      },
      reductionRecord: record,
    };
  }

  return {
    competitiveCandidates,
    target: {
      kind: "reduce",
      sessionId: record.sessionId,
    },
    reductionRecord: record,
    referenceRepoUnavailable: {
      reason: "message-lineage",
      messageSessionId: referenceRepo.messageSessionId,
    },
  };
}

async function resolveMessageVerifyTarget(
  input: ResolveVerifyTargetInput,
): Promise<ResolvedVerifyTarget> {
  const { root, messagesFilePath, target } = input;

  const [record] = await readMessageRecords({
    root,
    messagesFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.sessionId,
  });

  if (!record) {
    throw new CliError(
      `Message session \`${target.sessionId}\` not found.`,
      [],
      [
        "Re-run `voratiq message` or confirm the session id in `.voratiq/message/index.json`.",
      ],
    );
  }

  if (!TERMINAL_MESSAGE_STATUSES.includes(record.status)) {
    throw new CliError(
      `Message session \`${target.sessionId}\` is not complete.`,
      [`Status: \`${record.status}\`.`],
      [
        "Wait for the message session to finish before running `voratiq verify`.",
      ],
    );
  }

  const recipients = resolveVerifiableMessageRecipients(record);
  if (recipients.length === 0) {
    throw new CliError(
      `Message session \`${target.sessionId}\` has no verifiable message responses.`,
      [
        "Verification requires at least one succeeded recipient with a durable `response.md` artifact.",
      ],
      [
        "Re-run `voratiq message` to capture at least one succeeded response before running `voratiq verify`.",
      ],
    );
  }

  return {
    competitiveCandidates: recipients.map((recipient) => ({
      canonicalId: recipient.agentId,
      forbiddenIdentityTokens: [recipient.agentId],
    })),
    target: {
      kind: "message",
      sessionId: record.sessionId,
    },
    messageRecord: record,
  };
}

function collectRunCandidateIdentityTokens(options: {
  runRecord: RunRecord;
  candidateId: string;
}): string[] {
  const { runRecord, candidateId } = options;
  const tokens = new Set<string>();
  tokens.add(candidateId);
  for (const agent of runRecord.agents) {
    if (agent.agentId !== candidateId) {
      continue;
    }
    tokens.add(agent.agentId);
    if (agent.model.trim().length > 0) {
      tokens.add(agent.model);
    }
  }
  return Array.from(tokens);
}

type ReductionReferenceRepoResolution =
  | {
      kind: "git";
      baseRevisionSha: string;
    }
  | {
      kind: "none";
      messageSessionId: string;
    };

async function resolveReductionReferenceRepo(options: {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
  verificationsFilePath: string;
  reductionRecord: ReductionRecord;
  seenReductionIds?: Set<string>;
}): Promise<ReductionReferenceRepoResolution> {
  const {
    root,
    specsFilePath,
    runsFilePath,
    reductionsFilePath,
    messagesFilePath,
    verificationsFilePath,
    reductionRecord,
    seenReductionIds = new Set<string>(),
  } = options;

  if (seenReductionIds.has(reductionRecord.sessionId)) {
    throw new CliError(
      `Reduction session \`${reductionRecord.sessionId}\` has a recursive target chain.`,
      [],
      [
        "Inspect `.voratiq/reduce/index.json` and repair the reduction target metadata.",
      ],
    );
  }
  seenReductionIds.add(reductionRecord.sessionId);

  switch (reductionRecord.target.type) {
    case "spec": {
      const [record] = await readSpecRecords({
        root,
        specsFilePath,
        limit: 1,
        predicate: (entry) => entry.sessionId === reductionRecord.target.id,
      });
      if (!record) {
        throw new CliError(
          `Spec session \`${reductionRecord.target.id}\` referenced by reduction \`${reductionRecord.sessionId}\` was not found.`,
        );
      }
      return {
        kind: "git",
        baseRevisionSha: resolveSpecBaseRevisionSha(record, {
          ownerLabel: `reduction \`${reductionRecord.sessionId}\``,
        }),
      };
    }
    case "run": {
      const { records } = await fetchRunsSafely({
        root,
        runsFilePath,
        runId: reductionRecord.target.id,
        filters: { includeDeleted: true },
      }).catch((error) => {
        if (error instanceof RunRecordNotFoundError) {
          throw new RunNotFoundCliError(reductionRecord.target.id);
        }
        throw error;
      });
      const runRecord = records[0];
      if (!runRecord) {
        throw new RunNotFoundCliError(reductionRecord.target.id);
      }
      return {
        kind: "git",
        baseRevisionSha: runRecord.baseRevisionSha,
      };
    }
    case "verify": {
      const [verificationRecord] = await readVerificationRecords({
        root,
        verificationsFilePath,
        limit: 1,
        predicate: (entry) => entry.sessionId === reductionRecord.target.id,
      });
      if (!verificationRecord) {
        throw new CliError(
          `Verification session \`${reductionRecord.target.id}\` referenced by reduction \`${reductionRecord.sessionId}\` was not found.`,
        );
      }

      switch (verificationRecord.target.kind) {
        case "run": {
          const { records } = await fetchRunsSafely({
            root,
            runsFilePath,
            runId: verificationRecord.target.sessionId,
            filters: { includeDeleted: true },
          }).catch((error) => {
            if (error instanceof RunRecordNotFoundError) {
              throw new RunNotFoundCliError(
                verificationRecord.target.sessionId,
              );
            }
            throw error;
          });
          const runRecord = records[0];
          if (!runRecord) {
            throw new RunNotFoundCliError(verificationRecord.target.sessionId);
          }
          return {
            kind: "git",
            baseRevisionSha: runRecord.baseRevisionSha,
          };
        }
        case "spec": {
          const [record] = await readSpecRecords({
            root,
            specsFilePath,
            limit: 1,
            predicate: (entry) =>
              entry.sessionId === verificationRecord.target.sessionId,
          });
          if (!record) {
            throw new CliError(
              `Spec session \`${verificationRecord.target.sessionId}\` referenced by verification \`${verificationRecord.sessionId}\` was not found.`,
            );
          }
          return {
            kind: "git",
            baseRevisionSha: resolveSpecBaseRevisionSha(record, {
              ownerLabel: `verification \`${verificationRecord.sessionId}\``,
            }),
          };
        }
        case "reduce": {
          const [parentReduction] = await readReductionRecords({
            root,
            reductionsFilePath,
            limit: 1,
            predicate: (entry) =>
              entry.sessionId === verificationRecord.target.sessionId,
          });
          if (!parentReduction) {
            throw new CliError(
              `Reduction session \`${verificationRecord.target.sessionId}\` referenced by verification \`${verificationRecord.sessionId}\` was not found.`,
            );
          }
          return await resolveReductionReferenceRepo({
            root,
            specsFilePath,
            runsFilePath,
            reductionsFilePath,
            messagesFilePath,
            verificationsFilePath,
            reductionRecord: parentReduction,
            seenReductionIds,
          });
        }
        case "message": {
          const [messageRecord] = await readMessageRecords({
            root,
            messagesFilePath,
            limit: 1,
            predicate: (entry) =>
              entry.sessionId === verificationRecord.target.sessionId,
          });
          if (!messageRecord) {
            throw new CliError(
              `Message session \`${verificationRecord.target.sessionId}\` referenced by verification \`${verificationRecord.sessionId}\` was not found.`,
            );
          }
          return messageRecord.baseRevisionSha
            ? {
                kind: "git",
                baseRevisionSha: messageRecord.baseRevisionSha,
              }
            : {
                kind: "none",
                messageSessionId: messageRecord.sessionId,
              };
        }
      }
      throw new CliError(
        `Verification session \`${verificationRecord.sessionId}\` references an unsupported target kind.`,
      );
    }
    case "reduce": {
      const [parentReduction] = await readReductionRecords({
        root,
        reductionsFilePath,
        limit: 1,
        predicate: (entry) => entry.sessionId === reductionRecord.target.id,
      });
      if (!parentReduction) {
        throw new CliError(
          `Reduction session \`${reductionRecord.target.id}\` referenced by reduction \`${reductionRecord.sessionId}\` was not found.`,
        );
      }
      return await resolveReductionReferenceRepo({
        root,
        specsFilePath,
        runsFilePath,
        reductionsFilePath,
        messagesFilePath,
        verificationsFilePath,
        reductionRecord: parentReduction,
        seenReductionIds,
      });
    }
    case "message": {
      const [messageRecord] = await readMessageRecords({
        root,
        messagesFilePath,
        limit: 1,
        predicate: (entry) => entry.sessionId === reductionRecord.target.id,
      });
      if (!messageRecord) {
        throw new CliError(
          `Message session \`${reductionRecord.target.id}\` referenced by reduction \`${reductionRecord.sessionId}\` was not found.`,
        );
      }
      return messageRecord.baseRevisionSha
        ? {
            kind: "git",
            baseRevisionSha: messageRecord.baseRevisionSha,
          }
        : {
            kind: "none",
            messageSessionId: messageRecord.sessionId,
          };
    }
  }
}

function resolveVerifiableMessageRecipients(record: {
  recipients: ReadonlyArray<{
    agentId: string;
    status: string;
    outputPath?: string;
  }>;
}): Array<{
  agentId: string;
  outputPath: string;
}> {
  return record.recipients.flatMap((recipient) => {
    if (
      recipient.status !== "succeeded" ||
      typeof recipient.outputPath !== "string" ||
      !isCanonicalMessageResponseArtifact(recipient.outputPath)
    ) {
      return [];
    }
    return [
      {
        agentId: recipient.agentId,
        outputPath: recipient.outputPath,
      },
    ];
  });
}

function isCanonicalMessageResponseArtifact(outputPath: string): boolean {
  return basename(outputPath) === MESSAGE_RESPONSE_FILENAME;
}

function resolveSpecBaseRevisionSha(
  record: SpecRecord,
  options: {
    ownerLabel?: string;
  } = {},
): string {
  if (record.baseRevisionSha) {
    return record.baseRevisionSha;
  }

  const ownerLabel = options.ownerLabel
    ? `${options.ownerLabel} targets legacy spec session \`${record.sessionId}\``
    : `Spec session \`${record.sessionId}\``;

  throw new CliError(
    `${ownerLabel} is missing \`baseRevisionSha\`.`,
    [
      "This spec record was created before base revisions were persisted for spec sessions.",
    ],
    [
      "Re-run `voratiq spec` to regenerate the spec session before running `voratiq verify`.",
    ],
  );
}
