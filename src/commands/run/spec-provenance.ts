import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { load } from "js-yaml";
import { z } from "zod";

import { agentIdSchema } from "../../configs/agents/types.js";
import type {
  RunSpecSourceDescriptor,
  RunSpecTarget,
} from "../../domain/run/model/types.js";
import type { SpecAgentEntry } from "../../domain/spec/model/types.js";
import { readSpecRecords } from "../../domain/spec/persistence/adapter.js";
import { pathExists } from "../../utils/fs.js";
import { normalizePathForDisplay } from "../../utils/path.js";

const FRONTMATTER_PATTERN =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;
const TOP_LEVEL_VORATIQ_BLOCK_PATTERN = /^voratiq\s*:/mu;

interface ParsedFrontmatterBlock {
  readonly headerContent: string;
  readonly bodyContent: string;
  readonly lineBreak: "\n" | "\r\n";
}

interface ParsedVoratiqFrontmatter {
  readonly bodyContent: string;
  readonly source?: ParsedVoratiqSourceMetadata;
  readonly invalidProvenance?: Extract<
    RunSpecTarget,
    { kind: "file" }
  >["provenance"];
}

interface ParsedVoratiqSourceMetadata {
  readonly sessionId: string;
  readonly agentId: string;
}

const voratiqFrontmatterSourceSchema = z
  .object({
    operator: z.literal("spec"),
    sessionId: z.string().min(1),
    agentId: agentIdSchema,
  })
  .strict();

export interface ResolveRunSpecTargetInput {
  root: string;
  specDisplayPath: string;
  specsFilePath?: string;
  specAbsolutePath?: string;
}

export interface LoadRunSpecInputResult {
  readonly specContent: string;
  readonly specTarget: RunSpecTarget;
}

/**
 * Load run spec content, stripping only Voratiq-owned frontmatter before prompt construction.
 */
export async function loadRunSpecInput(
  input: ResolveRunSpecTargetInput & {
    specAbsolutePath: string;
  },
): Promise<LoadRunSpecInputResult> {
  const rawSpecContent = await readFile(input.specAbsolutePath, "utf8");
  const parsedFrontmatter = parseVoratiqFrontmatter(rawSpecContent);

  return {
    specContent: parsedFrontmatter.bodyContent,
    specTarget: await resolveRunSpecTarget({
      ...input,
      parsedFrontmatter,
    }),
  };
}

/**
 * Resolve a run's spec input to its upstream session identity when the
 * provided spec path is a generated spec artifact or a descendant that
 * carries Voratiq-owned provenance metadata.
 */
export async function resolveRunSpecTarget(
  input: ResolveRunSpecTargetInput & {
    parsedFrontmatter?: ParsedVoratiqFrontmatter;
  },
): Promise<RunSpecTarget> {
  const { root, specDisplayPath, specsFilePath, specAbsolutePath } = input;
  const normalizedSpecPath = normalizePathForDisplay(specDisplayPath);

  const parsedFrontmatter =
    input.parsedFrontmatter ??
    (specAbsolutePath
      ? parseVoratiqFrontmatter(await readFile(specAbsolutePath, "utf8"))
      : undefined);

  if (!specsFilePath || !(await pathExists(specsFilePath))) {
    return parsedFrontmatter?.invalidProvenance
      ? {
          kind: "file",
          provenance: parsedFrontmatter.invalidProvenance,
        }
      : { kind: "file" };
  }

  try {
    const exactMatch = await readExactSpecArtifact({
      root,
      specsFilePath,
      normalizedSpecPath,
      specAbsolutePath,
      bodyContent: parsedFrontmatter?.bodyContent,
    });
    if (exactMatch) {
      return exactMatch;
    }

    if (parsedFrontmatter?.source) {
      return await resolveDerivedSpecTarget({
        root,
        specsFilePath,
        source: parsedFrontmatter.source,
        bodyContent: parsedFrontmatter.bodyContent,
      });
    }
  } catch {
    // Provenance is best-effort metadata. Runs should still proceed when
    // spec-session history cannot be read.
    return parsedFrontmatter?.invalidProvenance
      ? {
          kind: "file",
          provenance: parsedFrontmatter.invalidProvenance,
        }
      : { kind: "file" };
  }

  if (parsedFrontmatter?.invalidProvenance) {
    return {
      kind: "file",
      provenance: parsedFrontmatter.invalidProvenance,
    };
  }

  return { kind: "file" };
}

async function readExactSpecArtifact(options: {
  root: string;
  specsFilePath: string;
  normalizedSpecPath: string;
  specAbsolutePath?: string;
  bodyContent?: string;
}): Promise<RunSpecTarget | undefined> {
  const {
    root,
    specsFilePath,
    normalizedSpecPath,
    specAbsolutePath,
    bodyContent,
  } = options;
  const [record] = await readSpecRecords({
    root,
    specsFilePath,
    limit: 1,
    predicate: (entry) =>
      entry.agents.some(
        (agent) =>
          typeof agent.outputPath === "string" &&
          normalizePathForDisplay(agent.outputPath) === normalizedSpecPath,
      ),
  });

  if (!record) {
    return undefined;
  }

  const agent = record.agents.find(
    (entry) =>
      typeof entry.outputPath === "string" &&
      normalizePathForDisplay(entry.outputPath) === normalizedSpecPath,
  );

  if (!agent) {
    return {
      kind: "spec",
      sessionId: record.sessionId,
    };
  }

  const source = toRecordedSpecSourceDescriptor({
    sessionId: record.sessionId,
    agent,
  });
  if (!source) {
    return {
      kind: "spec",
      sessionId: record.sessionId,
    };
  }

  const currentBodyContent =
    typeof bodyContent === "string"
      ? bodyContent
      : await readSpecBodyContent(specAbsolutePath);
  if (typeof currentBodyContent !== "string") {
    return {
      kind: "spec",
      sessionId: record.sessionId,
    };
  }

  const currentContentHash = hashSpecBody(currentBodyContent);
  return {
    kind: "spec",
    sessionId: record.sessionId,
    provenance:
      currentContentHash === source.contentHash
        ? {
            lineage: "exact",
            source,
          }
        : {
            lineage: "derived_modified",
            source,
            currentContentHash,
          },
  };
}

async function resolveDerivedSpecTarget(options: {
  root: string;
  specsFilePath: string;
  source: ParsedVoratiqSourceMetadata;
  bodyContent: string;
}): Promise<RunSpecTarget> {
  const { root, specsFilePath, source, bodyContent } = options;
  const currentContentHash = hashSpecBody(bodyContent);
  const [record] = await readSpecRecords({
    root,
    specsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === source.sessionId,
  });

  if (!record) {
    return {
      kind: "spec",
      sessionId: source.sessionId,
      provenance: {
        lineage: "invalid",
        issueCode: "stale_source",
        source: toRunSpecSourceHint(source),
        currentContentHash,
      },
    };
  }

  const agent = record.agents.find((entry) => entry.agentId === source.agentId);
  const resolvedSource = agent
    ? toRecordedSpecSourceDescriptor({
        sessionId: source.sessionId,
        agent,
      })
    : undefined;

  if (!agent) {
    return {
      kind: "spec",
      sessionId: source.sessionId,
      provenance: {
        lineage: "invalid",
        issueCode: "stale_source",
        source: toRunSpecSourceHint(source),
        currentContentHash,
      },
    };
  }

  if (!resolvedSource) {
    return {
      kind: "spec",
      sessionId: source.sessionId,
    };
  }

  const sourceContentHash = await readSourceArtifactHash({
    root,
    source: resolvedSource,
  });
  if (sourceContentHash !== resolvedSource.contentHash) {
    return {
      kind: "spec",
      sessionId: source.sessionId,
      provenance: {
        lineage: "invalid",
        issueCode: "stale_source",
        source: resolvedSource,
        currentContentHash,
      },
    };
  }

  return {
    kind: "spec",
    sessionId: source.sessionId,
    provenance: {
      lineage:
        currentContentHash === resolvedSource.contentHash
          ? "derived"
          : "derived_modified",
      source: resolvedSource,
      currentContentHash,
    },
  };
}

function parseVoratiqFrontmatter(content: string): ParsedVoratiqFrontmatter {
  const frontmatterBlock = extractFrontmatterBlock(content);
  if (!frontmatterBlock) {
    return { bodyContent: content };
  }

  const hasVoratiqBlock = TOP_LEVEL_VORATIQ_BLOCK_PATTERN.test(
    frontmatterBlock.headerContent,
  );
  let document: unknown;

  try {
    document = load(frontmatterBlock.headerContent, { json: false }) ?? {};
  } catch {
    const bodyContent = hasVoratiqBlock
      ? stripVoratiqFrontmatter(frontmatterBlock)
      : content;
    return hasVoratiqBlock
      ? {
          bodyContent,
          invalidProvenance: {
            lineage: "invalid",
            issueCode: "malformed_frontmatter",
            currentContentHash: hashSpecBody(bodyContent),
          },
        }
      : { bodyContent: content };
  }

  if (!isObject(document) || !("voratiq" in document)) {
    return { bodyContent: content };
  }

  const bodyContent = stripVoratiqFrontmatter(frontmatterBlock);
  const parsed = parseVoratiqMetadata(document.voratiq, bodyContent);
  return {
    bodyContent,
    ...parsed,
  };
}

function parseVoratiqMetadata(
  voratiqBlock: unknown,
  bodyContent: string,
): Pick<ParsedVoratiqFrontmatter, "source" | "invalidProvenance"> {
  if (!isObject(voratiqBlock)) {
    return {
      invalidProvenance: {
        lineage: "invalid",
        issueCode: "malformed_frontmatter",
        currentContentHash: hashSpecBody(bodyContent),
      },
    };
  }

  const parsedSource = voratiqFrontmatterSourceSchema.safeParse(
    voratiqBlock.source,
  );
  if (!parsedSource.success) {
    return {
      invalidProvenance: {
        lineage: "invalid",
        issueCode: "malformed_frontmatter",
        currentContentHash: hashSpecBody(bodyContent),
      },
    };
  }

  return {
    source: {
      sessionId: parsedSource.data.sessionId,
      agentId: parsedSource.data.agentId,
    },
  };
}

function extractFrontmatterBlock(
  content: string,
): ParsedFrontmatterBlock | undefined {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return undefined;
  }

  return {
    headerContent: match[1] ?? "",
    bodyContent: content.slice(match[0].length),
    lineBreak: match[0].includes("\r\n") ? "\r\n" : "\n",
  };
}

async function readSourceArtifactHash(options: {
  root: string;
  source: RunSpecSourceDescriptor;
}): Promise<`sha256:${string}` | undefined> {
  const { root, source } = options;

  try {
    const sourceContent = await readFile(
      resolve(root, source.outputPath),
      "utf8",
    );
    return hashSpecBody(parseVoratiqFrontmatter(sourceContent).bodyContent);
  } catch {
    return undefined;
  }
}

async function readSpecBodyContent(
  specAbsolutePath: string | undefined,
): Promise<string | undefined> {
  if (!specAbsolutePath) {
    return undefined;
  }

  try {
    return parseVoratiqFrontmatter(await readFile(specAbsolutePath, "utf8"))
      .bodyContent;
  } catch {
    return undefined;
  }
}

function stripVoratiqFrontmatter(
  frontmatterBlock: ParsedFrontmatterBlock,
): string {
  const strippedHeader = removeTopLevelYamlBlock(
    frontmatterBlock.headerContent,
    "voratiq",
    frontmatterBlock.lineBreak,
  );

  if (strippedHeader.trim().length === 0) {
    return frontmatterBlock.bodyContent;
  }

  return ["---", strippedHeader, "---", frontmatterBlock.bodyContent].join(
    frontmatterBlock.lineBreak,
  );
}

function hashSpecBody(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function toRecordedSpecSourceDescriptor(options: {
  sessionId: string;
  agent: SpecAgentEntry;
}): RunSpecSourceDescriptor | undefined {
  const { sessionId, agent } = options;
  if (
    typeof agent.outputPath !== "string" ||
    typeof agent.contentHash !== "string"
  ) {
    return undefined;
  }

  return {
    kind: "spec",
    sessionId,
    agentId: agent.agentId,
    outputPath: normalizePathForDisplay(agent.outputPath),
    contentHash: agent.contentHash,
  };
}

function toRunSpecSourceHint(
  source: ParsedVoratiqSourceMetadata,
): NonNullable<
  Extract<RunSpecTarget, { kind: "file" }>["provenance"]
>["source"] {
  return {
    kind: "spec",
    sessionId: source.sessionId,
    agentId: source.agentId,
  };
}

function removeTopLevelYamlBlock(
  headerContent: string,
  key: string,
  lineBreak: "\n" | "\r\n",
): string {
  const lines = headerContent.split(lineBreak);
  const startIndex = lines.findIndex((line) =>
    new RegExp(`^${key}\\s*:(?:[ \\t]*(?:#.*)?)?$`, "u").test(line),
  );
  if (startIndex === -1) {
    return headerContent;
  }

  let endIndex = startIndex + 1;
  while (endIndex < lines.length) {
    const currentLine = lines[endIndex];
    if (currentLine === undefined) {
      break;
    }

    if (currentLine.trim().length === 0) {
      const nextNonEmptyIndex = findNextNonEmptyLineIndex(lines, endIndex + 1);
      if (
        nextNonEmptyIndex !== undefined &&
        /^[ \t]/u.test(lines[nextNonEmptyIndex] ?? "")
      ) {
        endIndex += 1;
        continue;
      }
      break;
    }

    if (!/^[ \t]/u.test(currentLine)) {
      break;
    }

    endIndex += 1;
  }

  return [...lines.slice(0, startIndex), ...lines.slice(endIndex)].join(
    lineBreak,
  );
}

function findNextNonEmptyLineIndex(
  lines: readonly string[],
  startIndex: number,
): number | undefined {
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().length > 0) {
      return index;
    }
  }

  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
