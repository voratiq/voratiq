import { type Command } from "commander";
import { z } from "zod";

import {
  type ListMode,
  listModes,
  type ListOperator,
  listOperators,
} from "../contracts/list.js";

const nonEmptyStringSchema = z.string().min(1, "must not be empty");
const positiveIntegerSchema = z
  .number()
  .int("must be an integer")
  .positive("must be greater than 0");
const optionalNonEmptyStringArraySchema = z
  .array(nonEmptyStringSchema)
  .min(1, "must include at least one value")
  .optional();

export const externalExecutionOperators = [
  "spec",
  "run",
  "reduce",
  "verify",
  "message",
  "apply",
] as const;

export const externalInspectionOperators = listOperators;

export const externalInspectionModes = listModes;

export type ExternalExecutionOperator =
  (typeof externalExecutionOperators)[number];
export type ExternalInspectionOperator = ListOperator;
export type ExternalInspectionMode = ListMode;

export const externalExecutionOperatorSchema = z.enum(
  externalExecutionOperators,
);
export const externalInspectionOperatorSchema = z.enum(
  externalInspectionOperators,
);
export const externalInspectionModeSchema = z.enum(externalInspectionModes);

export const externalSpecExecutionInputSchema = z
  .object({
    description: nonEmptyStringSchema,
    agentIds: optionalNonEmptyStringArraySchema,
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    title: nonEmptyStringSchema.optional(),
    extraContext: optionalNonEmptyStringArraySchema,
  })
  .strict();

export const externalRunExecutionInputSchema = z
  .object({
    specPath: nonEmptyStringSchema,
    agentIds: optionalNonEmptyStringArraySchema,
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    branch: z.boolean().optional(),
    extraContext: optionalNonEmptyStringArraySchema,
  })
  .strict();

export const externalReduceExecutionInputSchema = z
  .object({
    target: z
      .object({
        type: z.enum(["spec", "run", "reduce", "verify", "message"]),
        id: nonEmptyStringSchema,
      })
      .strict(),
    agentIds: optionalNonEmptyStringArraySchema,
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    extraContext: optionalNonEmptyStringArraySchema,
  })
  .strict();

export const externalMessageExecutionInputSchema = z
  .object({
    prompt: nonEmptyStringSchema,
    agentIds: optionalNonEmptyStringArraySchema,
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    extraContext: optionalNonEmptyStringArraySchema,
  })
  .strict();

export const externalVerifyExecutionInputSchema = z
  .object({
    target: z
      .object({
        kind: z.enum(["spec", "run", "reduce", "message"]),
        sessionId: nonEmptyStringSchema,
      })
      .strict(),
    agentIds: optionalNonEmptyStringArraySchema,
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    extraContext: optionalNonEmptyStringArraySchema,
  })
  .strict();

export const externalApplyExecutionInputSchema = z
  .object({
    runId: nonEmptyStringSchema,
    agentId: nonEmptyStringSchema,
    ignoreBaseMismatch: z.boolean().optional(),
    commit: z.boolean().optional(),
  })
  .strict();

const externalListInspectionBaseSchema = z
  .object({
    operator: externalInspectionOperatorSchema,
  })
  .strict();

export const externalListSummaryInputSchema =
  externalListInspectionBaseSchema.extend({
    mode: z.literal("summary"),
    allStatuses: z.boolean().optional(),
    limit: positiveIntegerSchema.optional(),
  });

export const externalListDetailInputSchema =
  externalListInspectionBaseSchema.extend({
    mode: z.literal("detail"),
    sessionId: nonEmptyStringSchema,
    verbose: z.boolean().optional(),
  });

export const externalListInspectionInputSchema = z.discriminatedUnion("mode", [
  externalListSummaryInputSchema,
  externalListDetailInputSchema,
]);

export const externalExecutionInputSchemas = {
  spec: externalSpecExecutionInputSchema,
  run: externalRunExecutionInputSchema,
  reduce: externalReduceExecutionInputSchema,
  verify: externalVerifyExecutionInputSchema,
  message: externalMessageExecutionInputSchema,
  apply: externalApplyExecutionInputSchema,
} as const;

export const externalInspectionInputSchemas = {
  list: {
    summary: externalListSummaryInputSchema,
    detail: externalListDetailInputSchema,
    union: externalListInspectionInputSchema,
  },
} as const;

export type ExternalSpecExecutionInput = z.infer<
  typeof externalSpecExecutionInputSchema
>;
export type ExternalRunExecutionInput = z.infer<
  typeof externalRunExecutionInputSchema
>;
export type ExternalReduceExecutionInput = z.infer<
  typeof externalReduceExecutionInputSchema
>;
export type ExternalMessageExecutionInput = z.infer<
  typeof externalMessageExecutionInputSchema
>;
export type ExternalVerifyExecutionInput = z.infer<
  typeof externalVerifyExecutionInputSchema
>;
export type ExternalApplyExecutionInput = z.infer<
  typeof externalApplyExecutionInputSchema
>;
export type ExternalListInspectionInput = z.infer<
  typeof externalListInspectionInputSchema
>;

export const externalAdapterContractReference = {
  execution: {
    operators: externalExecutionOperators,
    envelope: {
      authoritativeType: "OperatorResultEnvelope",
      versioned: true,
    },
    exitCodesAreContract: true,
  },
  inspection: {
    command: "list",
    jsonOnly: true,
    operators: externalInspectionOperators,
    modes: externalInspectionModes,
    authoritativeType: "ListJsonOutput",
    versioned: false,
  },
  excludedCommands: ["auto", "doctor"] as const,
  compatibility: {
    additiveChangesAreNonBreaking: true,
    breakingChangesRequireExecutionEnvelopeVersionBump: true,
    breakingChanges: [
      "remove an existing field",
      "change a field type",
      "change the semantic meaning of an existing field",
      "change required-vs-optional status in a way that breaks clients",
    ] as const,
  },
  semantics: {
    executionWarningsField: "alerts",
    executionFailuresField: "error",
    inspectionWarningsField: "warnings",
    listNotFoundReturnsDetailWithNullSession: true,
    listNotFoundExitCode: 0,
    adaptersMustNotParseHumanTranscriptOutput: true,
  },
} as const;

const specCommandActionOptionsSchema = z
  .object({
    description: nonEmptyStringSchema,
    agent: z.array(nonEmptyStringSchema).optional(),
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    title: nonEmptyStringSchema.optional(),
    extraContext: z.array(nonEmptyStringSchema).optional(),
    json: z.boolean().optional(),
  })
  .strict();

const runCommandActionOptionsSchema = z
  .object({
    spec: nonEmptyStringSchema,
    agent: z.array(nonEmptyStringSchema).optional(),
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    branch: z.boolean().optional(),
    extraContext: z.array(nonEmptyStringSchema).optional(),
    json: z.boolean().optional(),
  })
  .strict();

const reduceCommandActionOptionsSchema = z
  .object({
    spec: nonEmptyStringSchema.optional(),
    run: nonEmptyStringSchema.optional(),
    reduce: nonEmptyStringSchema.optional(),
    verify: nonEmptyStringSchema.optional(),
    message: nonEmptyStringSchema.optional(),
    agent: z.array(nonEmptyStringSchema).optional(),
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    extraContext: z.array(nonEmptyStringSchema).optional(),
    json: z.boolean().optional(),
  })
  .strict();

const messageCommandActionOptionsSchema = z
  .object({
    prompt: nonEmptyStringSchema,
    agent: z.array(nonEmptyStringSchema).optional(),
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    extraContext: z.array(nonEmptyStringSchema).optional(),
    json: z.boolean().optional(),
  })
  .strict();

const verifyCommandActionOptionsSchema = z
  .object({
    spec: nonEmptyStringSchema.optional(),
    run: nonEmptyStringSchema.optional(),
    reduce: nonEmptyStringSchema.optional(),
    message: nonEmptyStringSchema.optional(),
    agent: z.array(nonEmptyStringSchema).optional(),
    profile: nonEmptyStringSchema.optional(),
    maxParallel: positiveIntegerSchema.optional(),
    extraContext: z.array(nonEmptyStringSchema).optional(),
    json: z.boolean().optional(),
  })
  .strict();

const applyCommandActionOptionsSchema = z
  .object({
    run: nonEmptyStringSchema,
    agent: nonEmptyStringSchema,
    ignoreBaseMismatch: z.boolean().optional(),
    commit: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .strict();

const listCommandActionOptionsSchema = z
  .object({
    spec: z.union([z.literal(true), nonEmptyStringSchema]).optional(),
    run: z.union([z.literal(true), nonEmptyStringSchema]).optional(),
    reduce: z.union([z.literal(true), nonEmptyStringSchema]).optional(),
    verify: z.union([z.literal(true), nonEmptyStringSchema]).optional(),
    message: z.union([z.literal(true), nonEmptyStringSchema]).optional(),
    interactive: z.union([z.literal(true), nonEmptyStringSchema]).optional(),
    limit: positiveIntegerSchema.optional(),
    allStatuses: z.boolean().optional(),
    verbose: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .strict();

type ListCommandActionOptionsInput = z.input<
  typeof listCommandActionOptionsSchema
>;

export function parseSpecExecutionCommandOptions(
  options: unknown,
  command: Command,
): ExternalSpecExecutionInput {
  const parsed = parseCommandOptions(
    specCommandActionOptionsSchema,
    options,
    command,
  );

  return parseCommandOptions(
    externalSpecExecutionInputSchema,
    {
      description: parsed.description,
      agentIds: normalizeOptionalStringArray(parsed.agent),
      profile: parsed.profile,
      maxParallel: parsed.maxParallel,
      title: parsed.title,
      extraContext: normalizeOptionalStringArray(parsed.extraContext),
    },
    command,
  );
}

export function parseRunExecutionCommandOptions(
  options: unknown,
  command: Command,
): ExternalRunExecutionInput {
  const parsed = parseCommandOptions(
    runCommandActionOptionsSchema,
    options,
    command,
  );

  return parseCommandOptions(
    externalRunExecutionInputSchema,
    {
      specPath: parsed.spec,
      agentIds: normalizeOptionalStringArray(parsed.agent),
      profile: parsed.profile,
      maxParallel: parsed.maxParallel,
      branch: normalizeOptionalBoolean(parsed.branch),
      extraContext: normalizeOptionalStringArray(parsed.extraContext),
    },
    command,
  );
}

export function parseReduceExecutionCommandOptions(
  options: unknown,
  command: Command,
): ExternalReduceExecutionInput {
  const parsed = parseCommandOptions(
    reduceCommandActionOptionsSchema,
    options,
    command,
  );
  const selected = resolveExclusiveStringSelection(
    [
      { key: "spec", flag: "--spec", value: "spec" },
      { key: "run", flag: "--run", value: "run" },
      { key: "reduce", flag: "--reduce", value: "reduce" },
      { key: "verify", flag: "--verify", value: "verify" },
      { key: "message", flag: "--message", value: "message" },
    ],
    parsed,
    command,
    "target flag",
  );

  return parseCommandOptions(
    externalReduceExecutionInputSchema,
    {
      target: {
        type: selected.value,
        id: selected.argument,
      },
      agentIds: normalizeOptionalStringArray(parsed.agent),
      profile: parsed.profile,
      maxParallel: parsed.maxParallel,
      extraContext: normalizeOptionalStringArray(parsed.extraContext),
    },
    command,
  );
}

export function parseMessageExecutionCommandOptions(
  options: unknown,
  command: Command,
): ExternalMessageExecutionInput {
  const parsed = parseCommandOptions(
    messageCommandActionOptionsSchema,
    options,
    command,
  );

  return parseCommandOptions(
    externalMessageExecutionInputSchema,
    {
      prompt: parsed.prompt,
      agentIds: normalizeOptionalStringArray(parsed.agent),
      profile: parsed.profile,
      maxParallel: parsed.maxParallel,
      extraContext: normalizeOptionalStringArray(parsed.extraContext),
    },
    command,
  );
}

export function parseVerifyExecutionCommandOptions(
  options: unknown,
  command: Command,
): ExternalVerifyExecutionInput {
  const parsed = parseCommandOptions(
    verifyCommandActionOptionsSchema,
    options,
    command,
  );
  const selected = resolveExclusiveStringSelection(
    [
      { key: "spec", flag: "--spec", value: "spec" },
      { key: "run", flag: "--run", value: "run" },
      { key: "reduce", flag: "--reduce", value: "reduce" },
      { key: "message", flag: "--message", value: "message" },
    ],
    parsed,
    command,
    "target flag",
  );

  return parseCommandOptions(
    externalVerifyExecutionInputSchema,
    {
      target: {
        kind: selected.value,
        sessionId: selected.argument,
      },
      agentIds: normalizeOptionalStringArray(parsed.agent),
      profile: parsed.profile,
      maxParallel: parsed.maxParallel,
      extraContext: normalizeOptionalStringArray(parsed.extraContext),
    },
    command,
  );
}

export function parseApplyExecutionCommandOptions(
  options: unknown,
  command: Command,
): ExternalApplyExecutionInput {
  const parsed = parseCommandOptions(
    applyCommandActionOptionsSchema,
    options,
    command,
  );

  return parseCommandOptions(
    externalApplyExecutionInputSchema,
    {
      runId: parsed.run,
      agentId: parsed.agent,
      ignoreBaseMismatch: normalizeOptionalBoolean(parsed.ignoreBaseMismatch),
      commit: normalizeOptionalBoolean(parsed.commit),
    },
    command,
  );
}

export function parseListInspectionCommandOptions(
  options: unknown,
  command: Command,
): ExternalListInspectionInput {
  const parsed = parseCommandOptions(
    listCommandActionOptionsSchema,
    options,
    command,
  );
  const selected = resolveExclusiveOptionalStringSelection(
    [
      { key: "spec", flag: "--spec", value: "spec" },
      { key: "run", flag: "--run", value: "run" },
      { key: "reduce", flag: "--reduce", value: "reduce" },
      { key: "verify", flag: "--verify", value: "verify" },
      { key: "message", flag: "--message", value: "message" },
      { key: "interactive", flag: "--interactive", value: "interactive" },
    ],
    parsed,
    command,
    "operator flag",
  );

  const mode = selected.argument ? "detail" : "summary";
  const verbose = normalizeOptionalBoolean(parsed.verbose);
  const allStatuses = normalizeOptionalBoolean(parsed.allStatuses);
  const json = normalizeOptionalBoolean(parsed.json);

  if (verbose && json) {
    failCommand(command, "`--verbose` cannot be used with JSON output.");
  }

  if (mode === "summary" && verbose) {
    failCommand(command, "`--verbose` requires detail scope.");
  }

  if (mode === "detail" && allStatuses) {
    failCommand(command, "`--all-statuses` applies only to summary scope.");
  }

  if (mode === "detail" && parsed.limit !== undefined) {
    failCommand(command, "`--limit` applies only to summary scope.");
  }

  return parseCommandOptions(
    externalListInspectionInputSchema,
    {
      operator: selected.value,
      mode,
      ...(selected.argument ? { sessionId: selected.argument } : {}),
      ...(mode === "summary"
        ? {
            limit: parsed.limit,
            allStatuses,
          }
        : {
            verbose,
          }),
    },
    command,
  );
}

function parseCommandOptions<T>(
  schema: z.ZodType<T>,
  input: unknown,
  command: Command,
): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.error.issues[0];
  const path =
    firstIssue && firstIssue.path.length > 0
      ? `${formatIssuePath(firstIssue.path)} `
      : "";

  failCommand(
    command,
    `${path}${firstIssue?.message ?? "contains invalid values"}`.trim(),
  );
}

function resolveExclusiveStringSelection<TValue extends string>(
  definitions: readonly {
    key: string;
    flag: string;
    value: TValue;
  }[],
  options: Record<string, unknown>,
  command: Command,
  subject: "target flag",
): { value: TValue; argument: string } {
  const entries = definitions
    .map((definition) => ({
      ...definition,
      argument: options[definition.key],
    }))
    .filter(
      (entry): entry is typeof entry & { argument: string } =>
        typeof entry.argument === "string" && entry.argument.length > 0,
    );

  if (entries.length !== 1) {
    failExclusiveSelection(command, subject, definitions, entries);
  }

  const selected = entries[0];
  if (!selected) {
    failExclusiveSelection(command, subject, definitions, entries);
  }

  return selected;
}

function resolveExclusiveOptionalStringSelection<TValue extends string>(
  definitions: readonly {
    key: keyof ListCommandActionOptionsInput;
    flag: string;
    value: TValue;
  }[],
  options: ListCommandActionOptionsInput,
  command: Command,
  subject: "operator flag",
): { value: TValue; argument?: string } {
  const entries = definitions
    .map((definition) => ({
      ...definition,
      raw: options[definition.key],
    }))
    .filter((entry) => entry.raw !== undefined);

  if (entries.length !== 1) {
    failExclusiveSelection(command, subject, definitions, entries);
  }

  const selected = entries[0];
  if (!selected) {
    failExclusiveSelection(command, subject, definitions, entries);
  }

  return {
    value: selected.value,
    argument: typeof selected.raw === "string" ? selected.raw : undefined,
  };
}

function failExclusiveSelection(
  command: Command,
  subject: "operator flag" | "target flag",
  definitions: readonly { flag: string }[],
  entries: readonly { flag: string }[],
): never {
  const flags = formatFlagList(
    definitions.map((definition) => definition.flag),
  );
  const detail =
    entries.length === 0
      ? `No ${subject} was provided.`
      : `Provided: ${entries.map((entry) => entry.flag).join(", ")}.`;

  failCommand(
    command,
    `exactly one ${subject} is required: ${flags} (${detail})`,
  );
}

function failCommand(command: Command, message: string): never {
  command.error(`error: ${message}`, { exitCode: 1 });
  throw new Error("Unreachable");
}

function formatFlagList(flags: readonly string[]): string {
  if (flags.length === 0) {
    return "";
  }

  if (flags.length === 1) {
    return `\`${flags[0]}\``;
  }

  if (flags.length === 2) {
    return `\`${flags[0]}\` or \`${flags[1]}\``;
  }

  const head = flags
    .slice(0, -1)
    .map((flag) => `\`${flag}\``)
    .join(", ");
  const tail = flags[flags.length - 1];
  return `${head}, or \`${tail}\``;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "input";
  }

  const rendered = path
    .filter((part): part is string | number => typeof part !== "symbol")
    .map(String)
    .join(".");
  return `${rendered} must`;
}

function normalizeOptionalStringArray(
  value: readonly string[] | undefined,
): string[] | undefined {
  return value && value.length > 0 ? [...value] : undefined;
}

function normalizeOptionalBoolean(
  value: boolean | undefined,
): true | undefined {
  return value ? true : undefined;
}
