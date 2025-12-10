export interface EvalDefault {
  readonly slug: string;
  readonly command?: string;
}

export const DEFAULT_EVAL_TEMPLATE_HEADER: readonly string[] = [
  "# Eval commands run after each agent finishes its run.",
  "# For each slug, provide the command that runs that eval.",
  "# Leave any entry blank (or delete it entirely) to skip that eval.",
  '# Example: format: "npm run format:check"',
  "",
];

export const DEFAULT_EVAL_DEFAULTS: readonly EvalDefault[] = [
  { slug: "format" },
  { slug: "lint" },
  { slug: "typecheck" },
  { slug: "tests" },
] as const;

export function serializeEvalDefaults(
  defaults: readonly EvalDefault[],
): string[] {
  const lines = [...DEFAULT_EVAL_TEMPLATE_HEADER];

  for (const { slug, command } of defaults) {
    if (command && command.length > 0) {
      lines.push(`${slug}: ${JSON.stringify(command)}`);
    } else {
      lines.push(`${slug}:`);
    }
  }

  return lines;
}

export function listEvalDefaults(): EvalDefault[] {
  return DEFAULT_EVAL_DEFAULTS.map((definition) => ({ ...definition }));
}
