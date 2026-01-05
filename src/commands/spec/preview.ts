import { buildMarkdownPreviewLines } from "../shared/preview.js";

export function buildDraftPreviewLines(draft: string): string[] {
  return buildMarkdownPreviewLines(draft, { pad: true });
}
