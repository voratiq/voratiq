import { renderTranscript } from "../utils/transcript.js";

export function renderReviewTranscript(options: {
  runId: string;
  outputPath: string;
  previewLines?: readonly string[];
  missingArtifacts?: readonly string[];
  suppressHint?: boolean;
}): string {
  const { runId, outputPath, previewLines, suppressHint } = options;

  const sections: string[][] = [];

  if (previewLines && previewLines.length > 0) {
    sections.push([...previewLines]);
  }

  sections.push([`Review: ${outputPath}`]);

  const hint = suppressHint
    ? undefined
    : !previewLines || previewLines.length === 0
      ? {
          message: `To integrate a solution:\n  voratiq apply --run ${runId} --agent <agent-id>`,
        }
      : undefined;

  return renderTranscript({ sections, hint });
}
