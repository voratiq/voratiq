import { renderTranscript } from "../utils/transcript.js";

export function renderSpecTranscript(
  outputPath: string,
  options: { suppressHint?: boolean } = {},
): string {
  const hint = options.suppressHint
    ? undefined
    : {
        message: `To begin a run:\n  voratiq run --spec ${outputPath}`,
      };

  return renderTranscript({
    sections: [[`Spec saved: ${outputPath}`]],
    hint,
  });
}
