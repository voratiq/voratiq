import { z } from "zod";

export const listOperators = ["spec", "run", "reduce", "verify"] as const;
export const listModes = ["table", "detail"] as const;

export type ListOperator = (typeof listOperators)[number];
export type ListMode = (typeof listModes)[number];

interface ListJsonRecordBase {
  id: string;
  status: string;
  createdAt: string;
}

interface ListJsonTargetRef {
  kind: string;
  id: string;
}

export interface RunListJsonTableRecord extends ListJsonRecordBase {
  specPath: string;
}

export interface SpecListJsonTableRecord extends ListJsonRecordBase {
  description: string | null;
}

export interface TargetedListJsonTableRecord extends ListJsonRecordBase {
  target: ListJsonTargetRef;
}

export type ListJsonTableRecord =
  | RunListJsonTableRecord
  | SpecListJsonTableRecord
  | TargetedListJsonTableRecord;

export interface RunListJsonRow {
  agentId: string;
  status: string;
  duration: string;
  changes: string | null;
}

export interface SpecListJsonRow {
  agentId: string;
  status: string;
  duration: string;
}

export interface ReduceListJsonRow {
  agentId: string;
  status: string;
  duration: string;
}

export interface VerifyListJsonRow {
  agentId: string | null;
  verifier: string;
  status: string;
  duration: string;
}

export type ListJsonRow =
  | RunListJsonRow
  | SpecListJsonRow
  | ReduceListJsonRow
  | VerifyListJsonRow;

export interface SpecListJsonArtifact {
  kind: "spec";
  agentId: string;
  path: string | null;
}

export interface ReductionListJsonArtifact {
  kind: "reduction";
  agentId: string;
  path: string | null;
}

export interface VerificationListJsonArtifact {
  kind: "result";
  agentId: string | null;
  verifier: string;
  path: string | null;
}

export type ListJsonArtifact =
  | SpecListJsonArtifact
  | ReductionListJsonArtifact
  | VerificationListJsonArtifact;

export interface ListJsonTableOutput {
  operator: ListOperator;
  mode: "table";
  records: ListJsonTableRecord[];
  warnings: string[];
}

export interface ListJsonDetailOutput {
  operator: ListOperator;
  mode: "detail";
  sessionId: string;
  session: {
    id: string;
    status: string;
    createdAt: string;
    elapsed?: string;
    workspacePath: string;
    rows: ListJsonRow[];
    artifacts: ListJsonArtifact[];
  } | null;
  warnings: string[];
}

export type ListJsonOutput = ListJsonTableOutput | ListJsonDetailOutput;

export const listOperatorSchema = z.enum(listOperators);
export const listModeSchema = z.enum(listModes);

const listJsonTargetRefSchema = z
  .object({
    kind: z.string(),
    id: z.string(),
  })
  .passthrough();

const listJsonRecordBaseSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

const runListJsonTableRecordSchema = listJsonRecordBaseSchema
  .extend({
    specPath: z.string(),
  })
  .passthrough();

const specListJsonTableRecordSchema = listJsonRecordBaseSchema
  .extend({
    description: z.string().nullable(),
  })
  .passthrough();

const targetedListJsonTableRecordSchema = listJsonRecordBaseSchema
  .extend({
    target: listJsonTargetRefSchema,
  })
  .passthrough();

const runListJsonRowSchema = z
  .object({
    agentId: z.string(),
    status: z.string(),
    duration: z.string(),
    changes: z.string().nullable(),
  })
  .passthrough();

const stageListJsonRowSchema = z
  .object({
    agentId: z.string(),
    status: z.string(),
    duration: z.string(),
  })
  .passthrough();

const verifyListJsonRowSchema = z
  .object({
    agentId: z.string().nullable(),
    verifier: z.string(),
    status: z.string(),
    duration: z.string(),
  })
  .passthrough();

const specListJsonArtifactSchema = z
  .object({
    kind: z.literal("spec"),
    agentId: z.string(),
    path: z.string().nullable(),
  })
  .passthrough();

const reductionListJsonArtifactSchema = z
  .object({
    kind: z.literal("reduction"),
    agentId: z.string(),
    path: z.string().nullable(),
  })
  .passthrough();

const verificationListJsonArtifactSchema = z
  .object({
    kind: z.literal("result"),
    agentId: z.string().nullable(),
    verifier: z.string(),
    path: z.string().nullable(),
  })
  .passthrough();

const listJsonDetailSessionSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    createdAt: z.string(),
    elapsed: z.string().optional(),
    workspacePath: z.string(),
    rows: z.array(
      z.union([
        runListJsonRowSchema,
        stageListJsonRowSchema,
        verifyListJsonRowSchema,
      ]),
    ),
    artifacts: z.array(
      z.union([
        specListJsonArtifactSchema,
        reductionListJsonArtifactSchema,
        verificationListJsonArtifactSchema,
      ]),
    ),
  })
  .passthrough();

const listJsonTableOutputSchema = z
  .object({
    operator: listOperatorSchema,
    mode: z.literal("table"),
    records: z.array(
      z.union([
        runListJsonTableRecordSchema,
        specListJsonTableRecordSchema,
        targetedListJsonTableRecordSchema,
      ]),
    ),
    warnings: z.array(z.string()),
  })
  .passthrough();

const listJsonDetailOutputSchema = z
  .object({
    operator: listOperatorSchema,
    mode: z.literal("detail"),
    sessionId: z.string(),
    session: listJsonDetailSessionSchema.nullable(),
    warnings: z.array(z.string()),
  })
  .passthrough();

export const listJsonOutputSchema = z.discriminatedUnion("mode", [
  listJsonTableOutputSchema,
  listJsonDetailOutputSchema,
]);

export function parseListJsonOutput(input: unknown): ListJsonOutput {
  return listJsonOutputSchema.parse(input) as ListJsonOutput;
}
