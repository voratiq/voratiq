export function buildDraftPreviewLines(draft: string): string[] {
  const normalizedDraft = draft.replace(/(?:\r?\n)+$/g, "");
  const lines = normalizedDraft.split(/\r?\n/);
  const fence = buildFence(normalizedDraft);
  return ["", `${fence}markdown`, ...lines, fence, ""];
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
