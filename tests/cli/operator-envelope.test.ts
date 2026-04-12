import {
  buildApplyOperatorEnvelope,
  buildFailedOperatorEnvelope,
  buildMessageOperatorEnvelope,
  buildPruneOperatorEnvelope,
  buildReduceOperatorEnvelope,
  buildRunOperatorEnvelope,
  buildSpecOperatorEnvelope,
  buildVerifyOperatorEnvelope,
  resolveJsonEnvelopeOperator,
} from "../../src/cli/operator-envelope.js";
import {
  buildResolvableSelectionDecision,
  buildUnresolvedSelectionDecision,
} from "../../src/policy/index.js";

describe("operator envelope helpers", () => {
  it("builds a spec envelope with a session id and spec path", () => {
    const envelope = buildSpecOperatorEnvelope({
      sessionId: "spec-123",
      generatedSpecPaths: [".voratiq/spec/sessions/spec-123/agent-a/spec.md"],
    });

    expect(envelope).toMatchObject({
      version: 1,
      operator: "spec",
      status: "succeeded",
      ids: {
        sessionId: "spec-123",
      },
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "session",
          role: "session",
          path: ".voratiq/spec/sessions/spec-123",
        },
        {
          kind: "spec",
          role: "candidate",
          agentId: "agent-a",
          path: ".voratiq/spec/sessions/spec-123/agent-a/spec.md",
        },
      ]),
    );
    expect(envelope.timestamp).toEqual(expect.any(String));
  });

  it("maps terminal run failure states to a failed envelope", () => {
    const envelope = buildRunOperatorEnvelope({
      runId: "run-123",
      specPath: "specs/task.md",
      status: "aborted",
    });

    expect(envelope).toMatchObject({
      operator: "run",
      status: "failed",
      ids: {
        runId: "run-123",
      },
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "session",
          role: "session",
          path: ".voratiq/run/sessions/run-123",
        },
        {
          kind: "spec",
          role: "input",
          path: "specs/task.md",
        },
      ]),
    );
  });

  it("includes the upstream spec session when a run is session-backed", () => {
    const envelope = buildRunOperatorEnvelope({
      runId: "run-123",
      specPath: ".voratiq/spec/sessions/spec-456/agent-a/spec.md",
      specTarget: {
        kind: "spec",
        sessionId: "spec-456",
        provenance: {
          lineage: "exact",
          source: {
            kind: "spec",
            sessionId: "spec-456",
            agentId: "agent-a",
            outputPath: ".voratiq/spec/sessions/spec-456/agent-a/spec.md",
            contentHash:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      },
      status: "succeeded",
    });

    expect(envelope.target).toEqual({
      kind: "spec",
      sessionId: "spec-456",
      lineage: "exact",
      source: {
        kind: "spec",
        sessionId: "spec-456",
        agentId: "agent-a",
        outputPath: ".voratiq/spec/sessions/spec-456/agent-a/spec.md",
        contentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
  });

  it("surfaces derived spec lineage in run envelopes", () => {
    const envelope = buildRunOperatorEnvelope({
      runId: "run-123",
      specPath: ".voratiq/spec/copied.md",
      specTarget: {
        kind: "spec",
        sessionId: "spec-456",
        provenance: {
          lineage: "derived_modified",
          source: {
            kind: "spec",
            sessionId: "spec-456",
            agentId: "agent-a",
            outputPath: ".voratiq/spec/sessions/spec-456/agent-a/spec.md",
            contentHash:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          currentContentHash:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
      status: "succeeded",
    });

    expect(envelope.target).toEqual({
      kind: "spec",
      sessionId: "spec-456",
      lineage: "derived_modified",
      source: {
        kind: "spec",
        sessionId: "spec-456",
        agentId: "agent-a",
        outputPath: ".voratiq/spec/sessions/spec-456/agent-a/spec.md",
        contentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      currentContentHash:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
  });

  it("warns when run input carries malformed spec provenance metadata", () => {
    const envelope = buildRunOperatorEnvelope({
      runId: "run-123",
      specPath: "specs/task.md",
      specTarget: {
        kind: "file",
        provenance: {
          lineage: "invalid",
          issueCode: "malformed_frontmatter",
          currentContentHash:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
      },
      status: "succeeded",
    });

    expect(envelope.target).toBeUndefined();
    expect(envelope.alerts).toEqual([
      {
        level: "warn",
        message: "Run spec ancestry metadata was malformed and was ignored.",
      },
    ]);
  });

  it("builds an unresolved verify envelope from selection state", () => {
    const envelope = buildVerifyOperatorEnvelope({
      verificationId: "verify-123",
      target: {
        kind: "run",
        sessionId: "run-123",
      },
      outputPath: ".voratiq/verify/sessions/verify-123",
      status: "succeeded",
      selection: buildUnresolvedSelectionDecision([
        {
          code: "verifier_disagreement",
          selections: [
            {
              verifierAgentId: "reviewer-a",
              selectedCanonicalAgentId: "agent-a",
            },
          ],
        },
      ]),
      warningMessage: "Selection policy loaded with warnings.",
    });

    expect(envelope).toMatchObject({
      operator: "verify",
      status: "unresolved",
      ids: {
        sessionId: "verify-123",
        runId: "run-123",
      },
      selection: {
        state: "unresolved",
      },
      unresolvedReasons: [{ code: "verifier_disagreement" }],
    });
    expect(envelope.artifacts).toEqual([
      {
        kind: "session",
        role: "session",
        path: ".voratiq/verify/sessions/verify-123",
      },
    ]);
    expect(envelope.alerts).toEqual(
      expect.arrayContaining([
        {
          level: "warn",
          message: "Selection policy loaded with warnings.",
        },
        {
          level: "warn",
          message: "Verification could not resolve a canonical candidate.",
        },
      ]),
    );
  });

  it("includes source ids for reduce envelopes", () => {
    const envelope = buildReduceOperatorEnvelope({
      reductionId: "reduce-123",
      target: {
        type: "verify",
        id: "verify-456",
      },
      status: "succeeded",
    });

    expect(envelope).toMatchObject({
      operator: "reduce",
      status: "succeeded",
      ids: {
        sessionId: "reduce-123",
        verificationId: "verify-456",
      },
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "session",
          role: "session",
          path: ".voratiq/reduce/sessions/reduce-123",
        },
        {
          kind: "verify",
          role: "input",
          path: ".voratiq/verify/sessions/verify-456",
        },
      ]),
    );
  });

  it("preserves prior reduction lineage for reduce-on-reduce envelopes", () => {
    const envelope = buildReduceOperatorEnvelope({
      reductionId: "reduce-123",
      target: {
        type: "reduce",
        id: "reduce-456",
      },
      status: "succeeded",
    });

    expect(envelope).toMatchObject({
      operator: "reduce",
      status: "succeeded",
      ids: {
        sessionId: "reduce-123",
        reductionId: "reduce-456",
      },
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "session",
          role: "session",
          path: ".voratiq/reduce/sessions/reduce-123",
        },
        {
          kind: "reduce",
          role: "input",
          path: ".voratiq/reduce/sessions/reduce-456",
        },
      ]),
    );
  });

  it("points message-backed reductions at the message session path", () => {
    const envelope = buildReduceOperatorEnvelope({
      reductionId: "reduce-123",
      target: {
        type: "message",
        id: "message-456",
      },
      status: "succeeded",
    });

    expect(envelope.ids).toMatchObject({
      sessionId: "reduce-123",
      messageId: "message-456",
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "message",
          role: "input",
          path: ".voratiq/message/sessions/message-456",
        },
      ]),
    );
  });

  it("surfaces apply warnings without changing the succeeded status", () => {
    const envelope = buildApplyOperatorEnvelope({
      runId: "run-123",
      agentId: "agent-a",
      diffPath: ".voratiq/run/sessions/run-123/agent-a/artifacts/diff.patch",
      ignoredBaseMismatch: true,
    });

    expect(envelope).toMatchObject({
      operator: "apply",
      status: "succeeded",
      ids: {
        runId: "run-123",
        agentId: "agent-a",
      },
      alerts: [
        {
          level: "warn",
          message: "Apply proceeded despite a base mismatch.",
        },
      ],
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "run",
          role: "target",
          path: ".voratiq/run/sessions/run-123",
        },
        {
          kind: "diff",
          role: "output",
          agentId: "agent-a",
          path: ".voratiq/run/sessions/run-123/agent-a/artifacts/diff.patch",
        },
      ]),
    );
  });

  it("maps prune aborts to failed envelopes", () => {
    const envelope = buildPruneOperatorEnvelope({
      status: "aborted",
      runId: "run-123",
      runPath: ".voratiq/run/sessions/run-123",
    });

    expect(envelope).toMatchObject({
      operator: "prune",
      status: "failed",
      ids: {
        runId: "run-123",
      },
    });
    expect(envelope.artifacts).toEqual([
      {
        kind: "run",
        role: "target",
        path: ".voratiq/run/sessions/run-123",
      },
    ]);
  });

  it("includes session and output artifacts in message envelopes", () => {
    const envelope = buildMessageOperatorEnvelope({
      sessionId: "message-123",
      status: "succeeded",
      outputArtifacts: [
        {
          agentId: "agent-a",
          outputPath:
            ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
        },
      ],
    });

    expect(envelope).toMatchObject({
      operator: "message",
      status: "succeeded",
      ids: {
        sessionId: "message-123",
      },
    });
    expect(envelope.artifacts).toEqual(
      expect.arrayContaining([
        {
          kind: "session",
          role: "session",
          path: ".voratiq/message/sessions/message-123",
        },
        {
          kind: "output",
          role: "output",
          agentId: "agent-a",
          path: ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
        },
      ]),
    );
  });

  it("builds resolvable verify envelopes with selection metadata", () => {
    const envelope = buildVerifyOperatorEnvelope({
      verificationId: "verify-456",
      target: {
        kind: "spec",
        sessionId: "spec-123",
      },
      outputPath: ".voratiq/verify/sessions/verify-456",
      status: "succeeded",
      selection: buildResolvableSelectionDecision("agent-a"),
      selectedSpecPath: "specs/final.md",
    });

    expect(envelope).toMatchObject({
      status: "succeeded",
      selection: {
        state: "resolvable",
        selectedCanonicalAgentId: "agent-a",
        selectedSpecPath: "specs/final.md",
      },
    });
    expect(envelope.unresolvedReasons).toBeUndefined();
  });

  it("carries explicit message target metadata in verify envelopes", () => {
    const envelope = buildVerifyOperatorEnvelope({
      verificationId: "verify-message-123",
      target: {
        kind: "message",
        sessionId: "message-123",
      },
      outputPath: ".voratiq/verify/sessions/verify-message-123",
      status: "succeeded",
    });

    expect(envelope).toMatchObject({
      operator: "verify",
      status: "succeeded",
      ids: {
        sessionId: "verify-message-123",
        messageId: "message-123",
      },
      target: {
        kind: "message",
        sessionId: "message-123",
      },
    });
  });

  it("normalizes failure envelopes and resolves json-mode operators", () => {
    const envelope = buildFailedOperatorEnvelope({
      operator: "spec",
      error: new Error("boom"),
    });

    expect(envelope).toMatchObject({
      operator: "spec",
      status: "failed",
      error: {
        code: "error",
        message: "boom",
      },
      artifacts: [],
    });

    expect(
      resolveJsonEnvelopeOperator(["node", "voratiq", "verify", "--json"]),
    ).toBe("verify");
    expect(
      resolveJsonEnvelopeOperator([
        "node",
        "voratiq",
        "verify",
        "--json",
        "--help",
      ]),
    ).toBeUndefined();
  });
});
