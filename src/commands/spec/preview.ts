import { renderBlocks } from "../../render/utils/transcript.js";
import { buildMarkdownPreviewLines } from "../shared/preview.js";

export function buildDraftPreviewLines(draft: string): string[] {
  const previewLines = buildMarkdownPreviewLines(draft);
  return renderBlocks({
    sections: [previewLines],
    leadingBlankLine: true,
    trailingBlankLine: true,
  });
}
