import { getAgentStatusStyle, getRunStatusStyle } from "../../status/colors.js";
import { renderTranscript } from "../utils/transcript.js";
import {
  buildStandardSessionShellSection,
  formatTranscriptStatusLabel,
  renderTranscriptStatusTable,
  resolveTranscriptShellStyle,
  type TranscriptShellStyleOptions,
} from "../utils/transcript-shell.js";

const DASH = "—";

export interface InteractiveTranscriptAgentBlock {
  agentId: string;
  status: "running" | "succeeded" | "failed";
  duration: string;
  outputPath?: string;
}

export interface InteractiveTranscriptOptions {
  sessionId: string;
  createdAt: string;
  elapsed: string;
  workspacePath: string;
  status: "running" | "succeeded" | "failed";
  agents: readonly InteractiveTranscriptAgentBlock[];
  isTty?: boolean;
  includeDetailSections?: boolean;
}

export function renderInteractiveTranscript(
  options: InteractiveTranscriptOptions,
): string {
  const includeDetailSections = options.includeDetailSections !== false;
  const style: TranscriptShellStyleOptions = { isTty: options.isTty };
  const resolvedStyle = resolveTranscriptShellStyle(style);
  const sections: string[][] = [];

  sections.push(
    buildStandardSessionShellSection({
      badgeText: options.sessionId,
      badgeVariant: "interactive",
      status: {
        value: options.status,
        color: getRunStatusStyle(options.status).cli,
      },
      elapsed: options.elapsed,
      createdAt: options.createdAt,
      workspacePath: options.workspacePath,
      style,
    }),
  );

  if (options.agents.length > 0) {
    sections.push(
      renderTranscriptStatusTable({
        rows: options.agents,
        agent: (row) => row.agentId,
        status: (row) =>
          formatTranscriptStatusLabel(
            row.status,
            getAgentStatusStyle(row.status).cli,
            resolvedStyle,
          ),
        duration: (row) => row.duration,
      }),
    );
    if (includeDetailSections) {
      sections.push(["---"]);
    }
  }

  if (!includeDetailSections) {
    return renderTranscript({ sections });
  }

  options.agents.forEach((agent, index) => {
    const block = [
      `Agent: ${agent.agentId}`,
      "",
      `Output: ${agent.outputPath ?? DASH}`,
    ];
    if (index < options.agents.length - 1) {
      block.push("", "---");
    }
    sections.push(block);
  });

  return renderTranscript({ sections });
}
