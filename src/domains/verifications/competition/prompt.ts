import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ResolvedExtraContextFile } from "../../../competition/shared/extra-context.js";
import { buildWorkspaceArtifactRequirements } from "../../../competition/shared/prompt-helpers.js";
import { toExtraContextContextSubpath } from "../../../extra-context/contract.js";
import type { VerificationTarget } from "../model/types.js";
import type { StagedVerificationInputs } from "./shared-layout.js";

export interface RubricTemplateContents {
  template: string;
  prompt: string;
  rubric: string;
  schema: string;
}

export async function loadRubricTemplate(options: {
  root: string;
  template: string;
}): Promise<RubricTemplateContents> {
  const { root, template } = options;
  const base = resolve(
    root,
    ".voratiq",
    "verifications",
    "templates",
    template,
  );
  const [prompt, rubric, schema] = await Promise.all([
    readFile(resolve(base, "prompt.md"), "utf8"),
    readFile(resolve(base, "rubric.md"), "utf8"),
    readFile(resolve(base, "schema.yaml"), "utf8"),
  ]);
  return { template, prompt, rubric, schema };
}

export function buildRubricPrompt(options: {
  template: RubricTemplateContents;
  target: VerificationTarget;
  staged: StagedVerificationInputs;
  extraContextFiles: readonly ResolvedExtraContextFile[];
}): string {
  const { template, target, staged, extraContextFiles } = options;
  const lines: string[] = [];

  lines.push(
    `# Verifier Template: ${template.template}`,
    "",
    template.prompt.trimEnd(),
    "",
    template.rubric.trimEnd(),
    "",
    "## Inputs",
  );

  if (staged.kind === "spec") {
    lines.push(
      `- Base repository snapshot (read-only): \`${staged.referenceRepoPath}/\``,
      `- Original description: \`${staged.descriptionPath}\``,
      "- Drafts:",
      ...staged.candidates.map((candidate) => {
        const parts = [`spec: \`${candidate.specPath}\``];
        if (candidate.specDataPath) {
          parts.push(`metadata: \`${candidate.specDataPath}\``);
        }
        return `  - ${candidate.alias} (${parts.join(", ")})`;
      }),
    );
  } else if (staged.kind === "run") {
    lines.push(
      `- Base repository snapshot (read-only): \`${staged.referenceRepoPath}/\``,
      `- Selected spec: \`${staged.specPath}\``,
      "- Candidates:",
      ...staged.candidates.map((candidate) => {
        const parts: string[] = [];
        if (candidate.diffPath) parts.push(`diff: \`${candidate.diffPath}\``);
        if (candidate.summaryPath) {
          parts.push(`summary: \`${candidate.summaryPath}\``);
        }
        const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return `  - ${candidate.alias}${suffix}`;
      }),
    );
  } else {
    lines.push(
      `- Base repository snapshot (read-only): \`${staged.referenceRepoPath}/\``,
      "- Reduction candidates:",
      ...staged.candidates.map(
        (candidate) => `  - ${candidate.alias}: \`${candidate.reductionPath}\``,
      ),
    );
  }

  lines.push(
    "",
    "## Output schema",
    "Return JSON matching this YAML schema exactly:",
    "",
    "```yaml",
    template.schema.trimEnd(),
    "```",
  );

  lines.push(
    "",
    "Output requirements:",
    ...buildWorkspaceArtifactRequirements([
      {
        instruction: "Save the structured rubric result as JSON",
        path: "result.json",
      },
    ]),
    "- Do not write files outside the workspace.",
    "",
    "Target metadata:",
    `- kind: ${target.kind}`,
    `- sessionId: ${target.sessionId}`,
  );

  if (extraContextFiles.length > 0) {
    lines.push(
      "",
      "Extra context files:",
      ...extraContextFiles.map(
        (file) =>
          `- \`context/${toExtraContextContextSubpath(file.stagedRelativePath)}\` (source: \`${file.displayPath}\`)`,
      ),
      "- Treat these files as supplemental context for this invocation.",
    );
  }

  return `${lines.join("\n")}\n`;
}
