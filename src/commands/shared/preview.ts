export interface MarkdownPreviewOptions {
  language?: string;
  pad?: boolean;
}

export function buildMarkdownPreviewLines(
  content: string,
  options: MarkdownPreviewOptions = {},
): string[] {
  const { language = "markdown", pad = false } = options;
  const normalizedContent = content.replace(/(?:\r?\n)+$/g, "");
  const lines = normalizedContent.split(/\r?\n/);
  const fence = buildFence(normalizedContent);
  const output: string[] = [];

  if (pad) {
    output.push("");
  }

  output.push(`${fence}${language}`, ...lines, fence);

  if (pad) {
    output.push("");
  }

  return output;
}

function buildFence(content: string): string {
  let maxRun = 0;
  let current = 0;
  for (const ch of content) {
    if (ch === "`") {
      current += 1;
      if (current > maxRun) {
        maxRun = current;
      }
    } else {
      current = 0;
    }
  }
  const fenceLength = Math.max(3, maxRun + 1);
  return "`".repeat(fenceLength);
}
