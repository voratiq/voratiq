import { Command } from "commander";

import { executeSyncCommand } from "../commands/sync/command.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderSyncTranscript } from "../render/transcripts/sync.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface SyncCommandOptions {
  writeOutput?: CommandOutputWriter;
}

export interface RunSyncCommandResult {
  body: string;
}

export async function runSyncCommand(
  options: SyncCommandOptions = {},
): Promise<RunSyncCommandResult> {
  const { writeOutput = writeCommandOutput } = options;
  writeOutput({
    alerts: [{ severity: "info", message: "Syncing Voratiq…" }],
  });

  const { root } = await resolveCliContext({ requireWorkspace: false });
  const result = await executeSyncCommand({ root });
  return { body: renderSyncTranscript(result) };
}

export function createSyncCommand(): Command {
  return new Command("sync")
    .description("Rescan providers and reconcile managed workspace config")
    .allowExcessArguments(false)
    .action(async () => {
      const result = await runSyncCommand();
      writeCommandOutput({ body: result.body });
    });
}
