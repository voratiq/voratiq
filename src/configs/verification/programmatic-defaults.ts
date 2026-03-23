import type { ProgrammaticSlug } from "./methods.js";
import {
  CANONICAL_PROGRAMMATIC_SLUGS,
  type ProgrammaticSuggestion,
} from "./programmatic-detect.js";

export interface ProgrammaticDefault {
  readonly slug: string;
  readonly command?: string;
}

export const DEFAULT_PROGRAMMATIC_TEMPLATE_HEADER: readonly string[] = [
  "# Repo-level verification config.",
  "# Configure only the stages and methods you use.",
  "# `run.programmatic` commands execute in candidate workspaces after a run finishes.",
  "# Leave any command blank (or delete it entirely) to skip that check.",
  "",
];

export const DEFAULT_PROGRAMMATIC_DEFAULTS: readonly ProgrammaticDefault[] = [
  { slug: "format" },
  { slug: "lint" },
  { slug: "typecheck" },
  { slug: "tests" },
] as const;

export function combineSuggestedProgrammaticCommands(
  suggestions: readonly ProgrammaticSuggestion[],
): Map<ProgrammaticSlug, string | undefined> {
  const combined = new Map<ProgrammaticSlug, string[]>();

  for (const suggestion of suggestions) {
    for (const [slug, command] of suggestion.commands) {
      const commands = combined.get(slug);
      if (!commands) {
        combined.set(slug, [command]);
        continue;
      }
      if (!commands.includes(command)) {
        commands.push(command);
      }
    }
  }

  const resolved = new Map<ProgrammaticSlug, string | undefined>();
  for (const slug of CANONICAL_PROGRAMMATIC_SLUGS) {
    const commands = combined.get(slug);
    resolved.set(
      slug,
      commands && commands.length > 0 ? commands.join(" && ") : undefined,
    );
  }

  return resolved;
}

export function listDetectedProgrammaticDefaults(
  suggestions: readonly ProgrammaticSuggestion[],
): ProgrammaticDefault[] {
  const commands = combineSuggestedProgrammaticCommands(suggestions);
  return CANONICAL_PROGRAMMATIC_SLUGS.map((slug) => ({
    slug,
    command: commands.get(slug),
  }));
}
