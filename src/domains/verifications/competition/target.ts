import type { ReductionRecord } from "../../reductions/model/types.js";
import type { RunRecord } from "../../runs/model/types.js";
import type { SpecRecord } from "../../specs/model/types.js";
import type { VerificationTarget } from "../model/types.js";

export interface VerificationCompetitiveCandidate {
  canonicalId: string;
  forbiddenIdentityTokens: readonly string[];
}

export type ResolvedVerificationTarget =
  | {
      baseRevisionSha: string;
      competitiveCandidates: readonly VerificationCompetitiveCandidate[];
      target: Extract<VerificationTarget, { kind: "spec" }>;
      specRecord: SpecRecord;
    }
  | {
      baseRevisionSha: string;
      competitiveCandidates: readonly VerificationCompetitiveCandidate[];
      target: Extract<VerificationTarget, { kind: "run" }>;
      runRecord: RunRecord;
    }
  | {
      baseRevisionSha: string;
      competitiveCandidates: readonly VerificationCompetitiveCandidate[];
      target: Extract<VerificationTarget, { kind: "reduce" }>;
      reductionRecord: ReductionRecord;
    };
