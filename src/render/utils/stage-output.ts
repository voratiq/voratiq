import type { TranscriptHintOptions } from "./transcript.js";
import { renderBlocks, renderTranscript } from "./transcript.js";

export interface StageFrameShell {
  metadataLines: readonly string[];
  statusTableLines?: readonly string[];
  footerLines?: readonly string[];
}

export function buildStageFrameSections(options: StageFrameShell): string[][] {
  const sections: string[][] = [];

  if (options.metadataLines.length > 0) {
    sections.push([...options.metadataLines]);
  }

  if (options.statusTableLines && options.statusTableLines.length > 0) {
    sections.push([...options.statusTableLines]);
  }

  if (options.footerLines && options.footerLines.length > 0) {
    sections.push([...options.footerLines]);
  }

  return sections;
}

export interface StageFrameLinesOptions extends StageFrameShell {
  leadingBlankLine?: boolean;
  trailingBlankLine?: boolean;
}

export function buildStageFrameLines(
  options: StageFrameLinesOptions,
): string[] {
  const sections = buildStageFrameSections(options);
  return renderBlocks({
    sections,
    leadingBlankLine: options.leadingBlankLine,
    trailingBlankLine: options.trailingBlankLine,
    trimTrailingBlankLines: false,
  });
}

export interface StageFinalFrameOptions extends StageFrameShell {
  hint?: TranscriptHintOptions;
}

export function renderStageFinalFrame(options: StageFinalFrameOptions): string {
  return renderTranscript({
    sections: buildStageFrameSections(options),
    hint: options.hint,
  });
}

export interface StageStartLineEmitter {
  emit(copy: string): void;
}

export function createStageStartLineEmitter(
  writeLine: (copy: string) => void,
): StageStartLineEmitter {
  let emitted = false;

  return {
    emit(copy: string): void {
      if (emitted) {
        return;
      }

      if (copy.trim().length === 0) {
        return;
      }

      emitted = true;
      writeLine(copy);
    },
  };
}
