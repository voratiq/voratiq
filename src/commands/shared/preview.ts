export interface MarkdownPreviewOptions {
  language?: string;
  pad?: boolean;
}

export interface MarkdownSectionOptions {
  heading: string;
  level?: number;
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

export function extractMarkdownSection(
  content: string,
  options: MarkdownSectionOptions,
): string | undefined {
  const { heading, level = 2 } = options;
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  const headingPrefix = `${"#".repeat(level)} `;
  const headingPattern = new RegExp(
    `^${escapeRegExp(headingPrefix)}${escapeRegExp(heading)}\\s*$`,
    "iu",
  );
  const nextHeadingPattern = new RegExp(`^${escapeRegExp(headingPrefix)}`, "u");

  const startIndex = lines.findIndex((line) =>
    headingPattern.test(line.trim()),
  );
  if (startIndex < 0) {
    return undefined;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (nextHeadingPattern.test(lines[index]?.trim() ?? "")) {
      endIndex = index;
      break;
    }
  }

  const sectionLines = lines.slice(startIndex, endIndex);
  while (
    sectionLines.length > 0 &&
    sectionLines[sectionLines.length - 1]?.trim() === ""
  ) {
    sectionLines.pop();
  }

  return sectionLines.join("\n");
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
