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

export function renderTranscript({
  metadata = [],
  sections = [],
  hint,
}: TranscriptOptions): string {
  const lines: string[] = [];

  const metadataLines = metadata
    .filter((entry): entry is TranscriptMetadataEntry & { value: string } => {
      return typeof entry.value === "string" && entry.value.length > 0;
    })
    .map((entry) => `${entry.label}: ${entry.value}`);

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

  return trimTrailingBlankLines(lines).join("\n");
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
