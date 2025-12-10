import type { AgentSectionInput } from "../utils/agents.js";
import { buildAgentSection } from "../utils/agents.js";
import type { RunDisplayInfo } from "../utils/runs.js";
import { buildRunMetadataSection } from "../utils/runs.js";
import type { TranscriptHintOptions } from "../utils/transcript.js";
import { renderTranscript } from "../utils/transcript.js";

export interface TranscriptScaffoldOptions {
  metadata: RunDisplayInfo;
  agents: readonly AgentSectionInput[];
  beforeAgents?: readonly string[][];
  afterAgents?: readonly string[][];
  warnings?: readonly string[];
  hint?: TranscriptHintOptions;
}

export function renderTranscriptWithMetadata(
  options: TranscriptScaffoldOptions,
): string {
  const sections = buildTranscriptSections(options);
  return renderTranscript({ sections, hint: options.hint });
}

function buildTranscriptSections(
  options: TranscriptScaffoldOptions,
): string[][] {
  const sections: string[][] = [];

  const metadataSection = buildRunMetadataSection(options.metadata);
  if (metadataSection.length > 0) {
    sections.push(metadataSection);
  }

  appendSections(sections, options.beforeAgents);

  options.agents.forEach((agent) => {
    const agentSection = buildAgentSection(agent);
    if (agentSection.length > 0) {
      sections.push(agentSection);
    }
  });

  appendSections(sections, buildWarningSections(options.warnings));
  appendSections(sections, options.afterAgents);

  return sections;
}

function buildWarningSections(
  warnings?: readonly string[],
): readonly string[][] | undefined {
  if (!warnings || warnings.length === 0) {
    return undefined;
  }

  return warnings.map((warning) => [warning]);
}

function appendSections(
  sections: string[][],
  blocks?: readonly string[][],
): void {
  if (!blocks) {
    return;
  }

  blocks.forEach((block) => {
    if (block.length === 0) {
      return;
    }
    sections.push(block);
  });
}
