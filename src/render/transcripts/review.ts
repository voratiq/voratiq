import { renderTranscript } from "../utils/transcript.js";

export function renderReviewTranscript(options: {
  runId: string;
  outputPath: string;
  previewLines?: readonly string[];
  missingArtifacts?: readonly string[];
  suppressHint?: boolean;
}): string {
  const { runId, outputPath, previewLines, missingArtifacts, suppressHint } =
    options;

  const sections: string[][] = [];

  if (missingArtifacts && missingArtifacts.length > 0) {
    sections.push([
      `Warning: Missing artifacts: ${missingArtifacts.join(", ")}. Review may be incomplete.`,
    ]);
  }

  if (previewLines && previewLines.length > 0) {
    sections.push([...previewLines]);
  }

  sections.push([`Review saved: ${outputPath}`]);

  const hint = suppressHint
    ? undefined
    : {
        message: `To integrate a solution:\n  voratiq apply --run ${runId} --agent <agent-id>`,
      };

  return renderTranscript({ sections, hint });
}
