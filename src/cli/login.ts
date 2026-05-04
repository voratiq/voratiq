import { Command } from "commander";

import { performAppSignIn } from "../app-session/login.js";
import { writeCommandOutput } from "./output.js";

export interface LoginCommandResult {
  body: string;
}

export async function runLoginCommand(): Promise<LoginCommandResult> {
  const result = await performAppSignIn({
    writeOutput: writeCommandOutput,
  });

  return {
    body: result.body,
  };
}

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Sign in to Voratiq App")
    .allowExcessArguments(false)
    .action(async () => {
      const result = await runLoginCommand();
      writeCommandOutput({ body: result.body });
    });
}
