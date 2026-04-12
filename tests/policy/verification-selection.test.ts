import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  VerificationMethodResultRef,
  VerificationRecord,
} from "../../src/domain/verify/model/types.js";
import {
  DEFAULT_VERIFICATION_WINNER_POLICY,
  loadVerificationSelectionPolicyOutput,
} from "../../src/policy/index.js";

interface RunRubricFixture {
  verifierId: string;
  template: string;
  result: Record<string, unknown>;
  status?: "succeeded" | "failed";
}

describe("verification winner policy defaults", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(
      join(tmpdir(), "voratiq-policy-verification-selection-"),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("defaults to stage-verification unanimity and ignores non-selection rubric templates", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-1",
        rubrics: [
          {
            verifierId: "verifier-selection",
            template: "run-verification",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
            },
          },
          {
            verifierId: "verifier-run-type",
            template: "run-type",
            result: {
              classification: "migration",
            },
          },
          {
            verifierId: "verifier-failure-modes",
            template: "failure-modes",
            result: {
              preferred: "v_bbbbbbbbbb",
              ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
            },
          },
        ],
      }),
    });

    expect(output.input.winnerPolicy).toEqual(
      DEFAULT_VERIFICATION_WINNER_POLICY,
    );
    expect(output.input.verifiers).toEqual([
      {
        verifierAgentId: "verifier-selection",
        status: "succeeded",
        preferredCandidateId: "v_aaaaaaaaaa",
        resolvedPreferredCandidateId: "agent-a",
      },
    ]);
    expect(output.decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-a",
      unresolvedReasons: [],
    });
  });

  it("keeps verifier disagreement unresolved when participating run-verification verifiers conflict", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-2",
        rubrics: [
          {
            verifierId: "verifier-a",
            template: "run-verification",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
            },
          },
          {
            verifierId: "verifier-b",
            template: "run-verification",
            result: {
              preferred: "v_bbbbbbbbbb",
              ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
            },
          },
          {
            verifierId: "verifier-run-type",
            template: "run-type",
            result: {},
          },
        ],
      }),
    });

    expect(
      output.input.verifiers.map((verifier) => verifier.verifierAgentId),
    ).toEqual(["verifier-a", "verifier-b"]);
    expect(output.decision.state).toBe("unresolved");
    expect(output.decision.unresolvedReasons).toEqual([
      {
        code: "verifier_disagreement",
        selections: [
          {
            verifierAgentId: "verifier-a",
            selectedCanonicalAgentId: "agent-a",
          },
          {
            verifierAgentId: "verifier-b",
            selectedCanonicalAgentId: "agent-b",
          },
        ],
      },
    ]);
  });

  it("returns rubric winner with a warning when no run programmatic candidates pass", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-3",
        rubrics: [
          {
            verifierId: "verifier-selection",
            template: "run-verification",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
            },
          },
        ],
        programmaticStatuses: {
          "agent-a": "failed",
          "agent-b": "failed",
        },
      }),
    });

    expect(output.decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-a",
      unresolvedReasons: [],
    });
    expect(output.warnings).toEqual([
      "No run candidate passed programmatic verification; proceeding with run-verification consensus.",
    ]);
  });

  it("returns rubric winner with a warning when the selected run-verification winner is not eligible", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-4",
        rubrics: [
          {
            verifierId: "verifier-selection",
            template: "run-verification",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
            },
          },
        ],
        programmaticStatuses: {
          "agent-a": "failed",
          "agent-b": "succeeded",
        },
      }),
    });

    expect(output.decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-a",
      unresolvedReasons: [],
    });
    expect(output.warnings).toEqual([
      "Selected run-verification winner failed programmatic verification; proceeding with run-verification consensus.",
    ]);
  });

  it("keeps selection unresolved when a non-participating verifier fails", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-non-participating-failed",
        rubrics: [
          {
            verifierId: "verifier-selection",
            template: "run-verification",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
            },
          },
          {
            verifierId: "verifier-failure-modes",
            template: "failure-modes",
            status: "failed",
            result: {
              preferred: "v_bbbbbbbbbb",
              ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
            },
          },
        ],
      }),
    });

    expect(output.input.verifiers).toEqual([
      {
        verifierAgentId: "verifier-selection",
        status: "succeeded",
        preferredCandidateId: "v_aaaaaaaaaa",
        resolvedPreferredCandidateId: "agent-a",
      },
      {
        verifierAgentId: "verifier-failure-modes",
        status: "failed",
      },
    ]);
    expect(output.decision).toEqual({
      state: "unresolved",
      applyable: false,
      unresolvedReasons: [
        {
          code: "verifier_failed",
          failedVerifierAgentIds: ["verifier-failure-modes"],
        },
      ],
    });
  });

  it("does not duplicate failed participating verifiers", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-participating-failed-once",
        rubrics: [
          {
            verifierId: "verifier-selection",
            template: "run-verification",
            status: "failed",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
            },
          },
          {
            verifierId: "verifier-failure-modes",
            template: "failure-modes",
            status: "failed",
            result: {
              preferred: "v_bbbbbbbbbb",
              ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
            },
          },
        ],
      }),
    });

    expect(output.input.verifiers).toEqual([
      {
        verifierAgentId: "verifier-selection",
        status: "failed",
      },
      {
        verifierAgentId: "verifier-failure-modes",
        status: "failed",
      },
    ]);
    expect(output.decision).toEqual({
      state: "unresolved",
      applyable: false,
      unresolvedReasons: [
        {
          code: "no_successful_verifiers",
          failedVerifierAgentIds: [
            "verifier-selection",
            "verifier-failure-modes",
          ],
        },
      ],
    });
  });

  it("does not resolve programmatic-only run verification without selector verifiers", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeRunVerificationRecord({
        root,
        verificationId: "verify-programmatic-only",
        rubrics: [],
        programmaticStatuses: {
          "agent-a": "succeeded",
          "agent-b": "failed",
        },
      }),
    });

    expect(output.input.verifiers).toEqual([]);
    expect(output.decision).toEqual({
      state: "unresolved",
      applyable: false,
      unresolvedReasons: [
        {
          code: "no_successful_verifiers",
          failedVerifierAgentIds: [],
        },
      ],
    });
    expect(output.warnings).toBeUndefined();
  });

  it("matches reduce stage participation to reduce-verification by default", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeReduceVerificationRecord({
        root,
        verificationId: "verify-5",
      }),
      canonicalCandidateIds: ["reduction-a", "reduction-b"],
    });

    expect(output.input.verifiers).toEqual([
      {
        verifierAgentId: "reduce-verifier",
        status: "succeeded",
        preferredCandidateId: "reduction-a",
        resolvedPreferredCandidateId: "reduction-a",
      },
    ]);
    expect(output.decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "reduction-a",
      unresolvedReasons: [],
    });
  });

  it("matches message stage participation to message-verification by default", async () => {
    const output = await loadVerificationSelectionPolicyOutput({
      root,
      record: await writeMessageVerificationRecord({
        root,
        verificationId: "verify-message-1",
      }),
    });

    expect(output.input.verifiers).toEqual([
      {
        verifierAgentId: "message-verifier",
        status: "succeeded",
        preferredCandidateId: "v_aaaaaaaaaa",
        resolvedPreferredCandidateId: "agent-a",
      },
    ]);
    expect(output.decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-a",
      unresolvedReasons: [],
    });
  });
});

async function writeRunVerificationRecord(options: {
  root: string;
  verificationId: string;
  rubrics: readonly RunRubricFixture[];
  programmaticStatuses?: Readonly<Record<string, "succeeded" | "failed">>;
}): Promise<VerificationRecord> {
  const { root, verificationId, rubrics, programmaticStatuses } = options;
  const generatedAt = "2026-03-19T20:00:05.000Z";
  const candidateIds = ["agent-a", "agent-b"];
  const aliasMap = {
    v_aaaaaaaaaa: "agent-a",
    v_bbbbbbbbbb: "agent-b",
  };
  const methods: VerificationMethodResultRef[] = [];

  if (programmaticStatuses) {
    const artifactPath = `.voratiq/verify/sessions/${verificationId}/programmatic/artifacts/result.json`;
    await writeArtifact(root, artifactPath, {
      method: "programmatic",
      generatedAt,
      target: {
        kind: "run",
        sessionId: "run-1",
        candidateIds,
      },
      scope: "run",
      candidates: candidateIds.map((candidateId) => ({
        candidateId,
        results: [
          {
            slug: "tests",
            status: programmaticStatuses[candidateId] ?? "failed",
            exitCode: programmaticStatuses[candidateId] === "succeeded" ? 0 : 1,
          },
        ],
      })),
    });
    methods.push({
      method: "programmatic",
      slug: "programmatic",
      scope: { kind: "run" },
      status: "succeeded",
      artifactPath,
      startedAt: generatedAt,
      completedAt: generatedAt,
    });
  }

  for (const rubric of rubrics) {
    const artifactPath = `.voratiq/verify/sessions/${verificationId}/${rubric.verifierId}/${rubric.template}/artifacts/result.json`;
    const status = rubric.status ?? "succeeded";
    await writeArtifact(root, artifactPath, {
      method: "rubric",
      template: rubric.template,
      verifierId: rubric.verifierId,
      generatedAt,
      status,
      result: rubric.result,
    });
    methods.push({
      method: "rubric",
      template: rubric.template,
      verifierId: rubric.verifierId,
      scope: { kind: "run" },
      status,
      artifactPath,
      startedAt: generatedAt,
      completedAt: generatedAt,
    });
  }

  return {
    sessionId: verificationId,
    createdAt: generatedAt,
    startedAt: generatedAt,
    completedAt: generatedAt,
    status: "succeeded",
    target: {
      kind: "run",
      sessionId: "run-1",
      candidateIds,
    },
    blinded: {
      enabled: true,
      aliasMap,
    },
    methods,
  };
}

async function writeReduceVerificationRecord(options: {
  root: string;
  verificationId: string;
}): Promise<VerificationRecord> {
  const { root, verificationId } = options;
  const generatedAt = "2026-03-19T20:00:05.000Z";
  const methods: VerificationMethodResultRef[] = [];

  const reduceArtifactPath = `.voratiq/verify/sessions/${verificationId}/reduce-verifier/reduce-verification/artifacts/result.json`;
  await writeArtifact(root, reduceArtifactPath, {
    method: "rubric",
    template: "reduce-verification",
    verifierId: "reduce-verifier",
    generatedAt,
    status: "succeeded",
    result: {
      preferred: "reduction-a",
      ranking: ["reduction-a", "reduction-b"],
    },
  });
  methods.push({
    method: "rubric",
    template: "reduce-verification",
    verifierId: "reduce-verifier",
    scope: { kind: "target" },
    status: "succeeded",
    artifactPath: reduceArtifactPath,
    startedAt: generatedAt,
    completedAt: generatedAt,
  });

  const specArtifactPath = `.voratiq/verify/sessions/${verificationId}/spec-verifier/spec-verification/artifacts/result.json`;
  await writeArtifact(root, specArtifactPath, {
    method: "rubric",
    template: "spec-verification",
    verifierId: "spec-verifier",
    generatedAt,
    status: "succeeded",
    result: {
      preferred: "reduction-b",
      ranking: ["reduction-b", "reduction-a"],
    },
  });
  methods.push({
    method: "rubric",
    template: "spec-verification",
    verifierId: "spec-verifier",
    scope: { kind: "target" },
    status: "succeeded",
    artifactPath: specArtifactPath,
    startedAt: generatedAt,
    completedAt: generatedAt,
  });

  return {
    sessionId: verificationId,
    createdAt: generatedAt,
    startedAt: generatedAt,
    completedAt: generatedAt,
    status: "succeeded",
    target: {
      kind: "reduce",
      sessionId: "reduce-1",
    },
    methods,
  };
}

async function writeMessageVerificationRecord(options: {
  root: string;
  verificationId: string;
}): Promise<VerificationRecord> {
  const { root, verificationId } = options;
  const generatedAt = "2026-03-19T20:00:05.000Z";
  const aliasMap = {
    v_aaaaaaaaaa: "agent-a",
    v_bbbbbbbbbb: "agent-b",
  };
  const methods: VerificationMethodResultRef[] = [];

  const messageArtifactPath = `.voratiq/verify/sessions/${verificationId}/message-verifier/message-verification/artifacts/result.json`;
  await writeArtifact(root, messageArtifactPath, {
    method: "rubric",
    template: "message-verification",
    verifierId: "message-verifier",
    generatedAt,
    status: "succeeded",
    result: {
      preferred: "v_aaaaaaaaaa",
      ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
    },
  });
  methods.push({
    method: "rubric",
    template: "message-verification",
    verifierId: "message-verifier",
    scope: { kind: "target" },
    status: "succeeded",
    artifactPath: messageArtifactPath,
    startedAt: generatedAt,
    completedAt: generatedAt,
  });

  const failureModesArtifactPath = `.voratiq/verify/sessions/${verificationId}/failure-reviewer/failure-modes/artifacts/result.json`;
  await writeArtifact(root, failureModesArtifactPath, {
    method: "rubric",
    template: "failure-modes",
    verifierId: "failure-reviewer",
    generatedAt,
    status: "succeeded",
    result: {
      preferred: "v_bbbbbbbbbb",
      ranking: ["v_bbbbbbbbbb", "v_aaaaaaaaaa"],
    },
  });
  methods.push({
    method: "rubric",
    template: "failure-modes",
    verifierId: "failure-reviewer",
    scope: { kind: "target" },
    status: "succeeded",
    artifactPath: failureModesArtifactPath,
    startedAt: generatedAt,
    completedAt: generatedAt,
  });

  return {
    sessionId: verificationId,
    createdAt: generatedAt,
    startedAt: generatedAt,
    completedAt: generatedAt,
    status: "succeeded",
    target: {
      kind: "message",
      sessionId: "message-1",
    },
    blinded: {
      enabled: true,
      aliasMap,
    },
    methods,
  };
}

async function writeArtifact(
  root: string,
  artifactPath: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(join(root, artifactPath)), { recursive: true });
  await writeFile(
    join(root, artifactPath),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}
