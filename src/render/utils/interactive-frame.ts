type CliWriter = Pick<NodeJS.WriteStream, "write">;

const ERASE_LINE = "\u001b[2K";
const CURSOR_COLUMN_START = "\u001b[0G";

export interface InteractiveFrameRenderer {
  render(lines: readonly string[]): void;
}

export function createInteractiveFrameRenderer(
  stdout: CliWriter,
): InteractiveFrameRenderer {
  let blockInitialized = false;
  let lastRenderedLines = 0;

  return {
    render(lines: readonly string[]): void {
      if (lines.length === 0) {
        return;
      }

      if (!blockInitialized) {
        stdout.write(lines.join("\n"));
        lastRenderedLines = lines.length;
        blockInitialized = true;
        return;
      }

      const linesToRewind = Math.max(0, lastRenderedLines - 1);
      if (linesToRewind > 0) {
        stdout.write(cursorUp(linesToRewind));
      }
      stdout.write(CURSOR_COLUMN_START);

      const totalLines = Math.max(lastRenderedLines, lines.length);
      const rewrittenLines: string[] = [];

      for (let index = 0; index < totalLines; index += 1) {
        const line = lines[index] ?? "";
        rewrittenLines.push(CURSOR_COLUMN_START, ERASE_LINE, line);
        if (index < totalLines - 1) {
          rewrittenLines.push("\n");
        }
      }

      stdout.write(rewrittenLines.join(""));
      lastRenderedLines = totalLines;
    },
  };
}

function cursorUp(lines: number): string {
  return `\u001b[${lines}F`;
}
