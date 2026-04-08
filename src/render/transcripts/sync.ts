import type { SyncCommandResult } from "../../commands/sync/types.js";
import { colorize } from "../../utils/colors.js";
import {
  formatWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_MANAGED_STATE_FILE,
  VORATIQ_ORCHESTRATION_FILE,
} from "../../workspace/structure.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";

export function renderSyncTranscript(result: SyncCommandResult): string {
  const sections: string[][] = [];

  sections.push(
    renderTable({
      columns: [
        { header: "CONFIGURATION", accessor: (row) => row.configuration },
        { header: "FILE", accessor: (row) => row.path },
      ],
      rows: [
        {
          configuration: "agents",
          path: formatWorkspacePath(VORATIQ_AGENTS_FILE),
        },
        {
          configuration: "orchestration",
          path: formatWorkspacePath(VORATIQ_ORCHESTRATION_FILE),
        },
        {
          configuration: "managed state",
          path: formatWorkspacePath(VORATIQ_MANAGED_STATE_FILE),
        },
      ],
    }),
  );

  if (result.workspaceBootstrapped) {
    sections.push([
      "Workspace was missing, so Voratiq bootstrapped it before syncing.",
    ]);
  }

  if (result.orchestrationSummary.skippedCustomized) {
    sections.push([
      "Skipped rewriting `orchestration.yaml` because it no longer looks managed.",
    ]);
  }

  sections.push([colorize("Voratiq synced.", "green")]);
  return renderTranscript({ sections });
}
