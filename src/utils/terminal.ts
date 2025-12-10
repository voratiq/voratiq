export interface InteractiveShellOptions {
  input?: NodeJS.ReadStream | null;
  output?: NodeJS.WriteStream | null;
}

export function isInteractiveShell(
  options: InteractiveShellOptions = {},
): boolean {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return Boolean(input?.isTTY && output?.isTTY);
}
