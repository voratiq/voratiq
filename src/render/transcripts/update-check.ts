import { renderBlocks } from "../utils/transcript.js";

const UPDATE_COMMAND_TEXT = "npm install -g voratiq@latest";

export function renderUpdatePromptPreface(
  notice: string,
  firstPrompt: boolean,
): string[] {
  const sections: string[][] = [
    [notice],
    [
      "What would you like to do?",
      `  [1] Update now (${UPDATE_COMMAND_TEXT})`,
      "  [2] Skip",
    ],
  ];

  return renderBlocks({
    sections,
    leadingBlankLine: firstPrompt,
  });
}

export function renderUpdateProgressLines(): string[] {
  return renderBlocks({
    sections: [[`Updating Voratiq via \`${UPDATE_COMMAND_TEXT}\``]],
    leadingBlankLine: true,
  });
}
