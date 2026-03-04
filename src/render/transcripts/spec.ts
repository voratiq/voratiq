import { renderStageFinalFrame } from "../utils/stage-output.js";

export function renderSpecTranscript(
  outputPath: string,
  options: { suppressHint?: boolean } = {},
): string {
  const hint = options.suppressHint
    ? undefined
    : {
        message: `Next:\n  voratiq run --spec ${outputPath}`,
      };

  return renderStageFinalFrame({
    metadataLines: [`Spec saved: ${outputPath}`],
    hint,
  });
}
