import { z } from "zod";

export const listOperators = [
  "spec",
  "run",
  "reduce",
  "verify",
  "message",
  "interactive",
] as const;
export const listModes = ["table", "detail"] as const;
export const listJsonModes = ["list", "detail"] as const;

export type ListOperator = (typeof listOperators)[number];
export type ListMode = (typeof listModes)[number];
export type ListJsonMode = (typeof listJsonModes)[number];

export type SessionListJsonTargetRef = {
  kind: ListOperator;
  sessionId: string;
  agentId?: string;
};

export type FileListJsonTargetRef = {
  kind: "file";
  path: string;
};

export type ListJsonTargetRef =
  | SessionListJsonTargetRef
  | FileListJsonTargetRef;

export interface ListJsonSessionBase {
  operator: ListOperator;
  sessionId: string;
  status: string;
  createdAt: string;
  target?: ListJsonTargetRef;
}

export interface ListJsonSummarySession extends ListJsonSessionBase {
  description?: string | null;
}

export interface ListJsonChanges {
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

export interface ListJsonArtifact {
  kind: string;
  role: "output" | "data";
  path: string;
}

export interface ListJsonAgent {
  agentId: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string;
  verifier?: string;
  changes?: ListJsonChanges;
  artifacts: ListJsonArtifact[];
}

export interface ListJsonDetailSession extends ListJsonSessionBase {
  startedAt?: string;
  completedAt?: string;
  workspacePath: string;
  description?: string | null;
  agents: ListJsonAgent[];
}

export interface ListJsonListOutput {
  operator: ListOperator;
  mode: "list";
  sessions: ListJsonSummarySession[];
  warnings: string[];
}

export interface ListJsonDetailOutput {
  operator: ListOperator;
  mode: "detail";
  session: ListJsonDetailSession | null;
  warnings: string[];
}

export type ListJsonOutput = ListJsonListOutput | ListJsonDetailOutput;

export const listOperatorSchema = z.enum(listOperators);
export const listModeSchema = z.enum(listModes);
export const listJsonModeSchema = z.enum(listJsonModes);

const listJsonSessionTargetRefSchema = z
  .object({
    kind: listOperatorSchema,
    sessionId: z.string(),
    agentId: z.string().optional(),
  })
  .passthrough();

const listJsonFileTargetRefSchema = z
  .object({
    kind: z.literal("file"),
    path: z.string(),
  })
  .passthrough();

const listJsonTargetRefSchema = z.discriminatedUnion("kind", [
  listJsonSessionTargetRefSchema,
  listJsonFileTargetRefSchema,
]);

const listJsonSessionBaseSchema = z
  .object({
    operator: listOperatorSchema,
    sessionId: z.string(),
    status: z.string(),
    createdAt: z.string(),
    target: listJsonTargetRefSchema.optional(),
  })
  .passthrough();

const listJsonSummarySessionSchema = listJsonSessionBaseSchema
  .extend({
    description: z.string().nullable().optional(),
  })
  .passthrough();

const listJsonChangesSchema = z
  .object({
    filesChanged: z.number().int().nonnegative().optional(),
    insertions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const listJsonArtifactSchema = z
  .object({
    kind: z.string(),
    role: z.enum(["output", "data"]),
    path: z.string(),
  })
  .passthrough();

const listJsonAgentSchema = z
  .object({
    agentId: z.string().nullable(),
    status: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    verifier: z.string().optional(),
    changes: listJsonChangesSchema.optional(),
    artifacts: z.array(listJsonArtifactSchema),
  })
  .passthrough();

const listJsonDetailSessionSchema = listJsonSessionBaseSchema
  .extend({
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    workspacePath: z.string(),
    description: z.string().nullable().optional(),
    agents: z.array(listJsonAgentSchema),
  })
  .passthrough();

const listJsonListOutputSchema = z
  .object({
    operator: listOperatorSchema,
    mode: z.literal("list"),
    sessions: z.array(listJsonSummarySessionSchema),
    warnings: z.array(z.string()),
  })
  .passthrough();

const listJsonDetailOutputSchema = z
  .object({
    operator: listOperatorSchema,
    mode: z.literal("detail"),
    session: listJsonDetailSessionSchema.nullable(),
    warnings: z.array(z.string()),
  })
  .passthrough();

export const listJsonOutputSchema = z.discriminatedUnion("mode", [
  listJsonListOutputSchema,
  listJsonDetailOutputSchema,
]);

export function parseListJsonOutput(input: unknown): ListJsonOutput {
  return listJsonOutputSchema.parse(input) as ListJsonOutput;
}
