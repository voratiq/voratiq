import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadVerificationPolicyInput } from "../../src/policy/index.js";

describe("verification policy handoff", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "voratiq-policy-verification-"));
    await mkdir(
      join(root, ".voratiq", "verifications", "sessions", "verify-1"),
      {
        recursive: true,
      },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads programmatic and rubric artifacts into an explicit policy input", async () => {
    const programmaticArtifactPath =
      ".voratiq/verifications/sessions/verify-1/programmatic/artifacts/result.json";
    const rubricArtifactPath =
      ".voratiq/verifications/sessions/verify-1/reviewer-a/run-review/artifacts/result.json";

    await mkdir(dirname(join(root, programmaticArtifactPath)), {
      recursive: true,
    });
    await writeFile(
      join(root, programmaticArtifactPath),
      JSON.stringify(
        {
          method: "programmatic",
          generatedAt: "2026-03-19T20:00:03.000Z",
          target: {
            kind: "run",
            sessionId: "run-1",
            candidateIds: ["agent-a", "agent-b"],
          },
          scope: "run",
          candidates: [
            {
              candidateId: "agent-a",
              results: [{ slug: "tests", status: "failed", exitCode: 1 }],
            },
            {
              candidateId: "agent-b",
              results: [{ slug: "tests", status: "succeeded", exitCode: 0 }],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await mkdir(dirname(join(root, rubricArtifactPath)), { recursive: true });
    await writeFile(
      join(root, rubricArtifactPath),
      JSON.stringify(
        {
          method: "rubric",
          template: "run-review",
          verifierId: "reviewer-a",
          generatedAt: "2026-03-19T20:00:05.000Z",
          status: "succeeded",
          result: {
            assessments: [
              { candidate_id: "r_aaaaaaaaaa", outcome: "best" },
              { candidate_id: "r_bbbbbbbbbb", outcome: "second" },
            ],
            preferred: "r_aaaaaaaaaa",
            ranking: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
            recommendation_rationale: "r_aaaaaaaaaa is the best candidate",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const input = await loadVerificationPolicyInput({
      root,
      record: {
        sessionId: "verify-1",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-1",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            r_aaaaaaaaaa: "agent-b",
            r_bbbbbbbbbb: "agent-a",
          },
        },
        methods: [
          {
            method: "programmatic",
            slug: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath: programmaticArtifactPath,
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "run-review",
            verifierId: "reviewer-a",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath: rubricArtifactPath,
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
          },
        ],
      },
    });

    expect(input).toEqual({
      sessionId: "verify-1",
      target: {
        kind: "run",
        sessionId: "run-1",
        candidateIds: ["agent-a", "agent-b"],
      },
      blinded: {
        enabled: true,
        aliasMap: {
          r_aaaaaaaaaa: "agent-b",
          r_bbbbbbbbbb: "agent-a",
        },
      },
      programmatic: {
        artifactPath: programmaticArtifactPath,
        scope: "run",
        candidates: [
          {
            candidateId: "agent-a",
            results: [{ slug: "tests", status: "failed", exitCode: 1 }],
          },
          {
            candidateId: "agent-b",
            results: [{ slug: "tests", status: "succeeded", exitCode: 0 }],
          },
        ],
      },
      rubrics: [
        {
          artifactPath: rubricArtifactPath,
          template: "run-review",
          verifierId: "reviewer-a",
          status: "succeeded",
          result: {
            assessments: [
              { candidate_id: "r_aaaaaaaaaa", outcome: "best" },
              { candidate_id: "r_bbbbbbbbbb", outcome: "second" },
            ],
            preferred: "r_aaaaaaaaaa",
            ranking: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
            recommendation_rationale: "r_aaaaaaaaaa is the best candidate",
          },
          error: undefined,
        },
      ],
    });
  });

  it("rejects blinded rubric artifacts whose selectors do not match the persisted alias map", async () => {
    const rubricArtifactPath =
      ".voratiq/verifications/sessions/verify-1/reviewer-a/run-review/artifacts/result.json";

    await mkdir(dirname(join(root, rubricArtifactPath)), { recursive: true });
    await writeFile(
      join(root, rubricArtifactPath),
      JSON.stringify(
        {
          method: "rubric",
          template: "run-review",
          verifierId: "reviewer-a",
          generatedAt: "2026-03-19T20:00:05.000Z",
          status: "succeeded",
          result: {
            preferred: "r_unknownalias",
            ranking: ["r_unknownalias"],
            recommendation_rationale: "r_unknownalias is the best candidate",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      loadVerificationPolicyInput({
        root,
        record: {
          sessionId: "verify-1",
          createdAt: "2026-03-19T20:00:00.000Z",
          startedAt: "2026-03-19T20:00:01.000Z",
          completedAt: "2026-03-19T20:00:05.000Z",
          status: "succeeded",
          target: {
            kind: "run",
            sessionId: "run-1",
            candidateIds: ["agent-a", "agent-b"],
          },
          blinded: {
            enabled: true,
            aliasMap: {
              r_aaaaaaaaaa: "agent-a",
              r_bbbbbbbbbb: "agent-b",
            },
          },
          methods: [
            {
              method: "rubric",
              template: "run-review",
              verifierId: "reviewer-a",
              scope: { kind: "run" },
              status: "succeeded",
              artifactPath: rubricArtifactPath,
              startedAt: "2026-03-19T20:00:03.000Z",
              completedAt: "2026-03-19T20:00:05.000Z",
            },
          ],
        },
      }),
    ).rejects.toThrow(/unknown blinded selector/u);
  });
});
