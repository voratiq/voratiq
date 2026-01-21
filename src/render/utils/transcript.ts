export interface TranscriptMetadataEntry {
  label: string;
  value?: string | null;
}

export interface TranscriptHintOptions {
  message: string;
  requireRerunSuffix?: boolean;
}

export interface TranscriptOptions {
  metadata?: TranscriptMetadataEntry[];
  sections?: string[][];
  hint?: TranscriptHintOptions;
}

export interface RenderBlocksOptions extends TranscriptOptions {
  leadingBlankLine?: boolean;
  trailingBlankLine?: boolean;
  trimTrailingBlankLines?: boolean;
}

export function renderBlocks({
  metadata = [],
  sections = [],
  hint,
  leadingBlankLine = false,
  trailingBlankLine = false,
  trimTrailingBlankLines: shouldTrim = true,
}: RenderBlocksOptions): string[] {
  const lines: string[] = [];

  const metadataLines = metadata
    .filter((entry): entry is TranscriptMetadataEntry & { value: string } => {
      return typeof entry.value === "string" && entry.value.length > 0;
    })
    .map((entry) => `${entry.label}: ${entry.value}`);

  if (leadingBlankLine) {
    lines.push("");
  }

  if (metadataLines.length > 0) {
    lines.push(...metadataLines, "");
  }

  sections.forEach((block, index) => {
    if (block.length === 0) {
      return;
    }

    lines.push(...block);

    if (index < sections.length - 1) {
      lines.push("");
    }
  });

  if (hint) {
    const resolvedHint = resolveHint(hint);
    if (sections.length > 0 || metadataLines.length > 0) {
      lines.push("");
    }
    lines.push(resolvedHint);
  }

  const trimmed = shouldTrim ? trimTrailingBlankLines(lines) : lines;
  if (trailingBlankLine) {
    trimmed.push("");
  }

  return trimmed;
}

export function renderTranscript(options: TranscriptOptions): string {
  return renderBlocks(options).join("\n");
}

function withRerunHint(message: string): string {
  return message.endsWith(" and rerun.") ? message : `${message} and rerun.`;
}

function resolveHint(hint: TranscriptHintOptions): string {
  if (hint.requireRerunSuffix) {
    return withRerunHint(hint.message);
  }

  return hint.message;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === "") {
    end -= 1;
  }

  return lines.slice(0, end);
}
