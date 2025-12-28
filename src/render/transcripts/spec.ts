import { renderTranscript } from "../utils/transcript.js";

export function renderSpecTranscript(outputPath: string): string {
  return renderTranscript({
    sections: [[`Spec saved: ${outputPath}`]],
    hint: {
      message: `To begin a run:\n  voratiq run --spec ${outputPath}`,
    },
  });
}
