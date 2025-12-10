const PROMPT_FLAG_TOKENS = new Set(["--prompt", "-p"]);

export function injectPromptArg(
  originalArgv: readonly string[],
  prompt: string,
): string[] {
  const argv = [...originalArgv];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (PROMPT_FLAG_TOKENS.has(token)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        argv.splice(index + 1, 0, prompt);
      } else {
        argv[index + 1] = prompt;
      }
      return argv;
    }
  }

  argv.push(prompt);
  return argv;
}
