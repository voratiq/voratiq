export interface InteractiveShellOptions {
  input?: NodeJS.ReadStream | null;
  output?: NodeJS.WriteStream | null;
}

const FALLBACK_INTERACTIVE_TERM = "xterm-256color";

export function isInteractiveShell(
  options: InteractiveShellOptions = {},
): boolean {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return Boolean(input?.isTTY && output?.isTTY);
}

export function normalizeInteractiveTerm(
  env: NodeJS.ProcessEnv,
  options: InteractiveShellOptions = {},
): string | undefined {
  if (!isInteractiveShell(options)) {
    return env.TERM;
  }

  const term = env.TERM?.trim();
  if (!term || term.toLowerCase() === "dumb") {
    return FALLBACK_INTERACTIVE_TERM;
  }

  return env.TERM;
}
