import type {
  AgentEvalEnhanced,
  AgentInvocationEnhanced,
} from "../../records/enhanced.js";
import type {
  AgentEvalView,
  AgentReport,
  AgentStatus,
} from "../../records/types.js";
import {
  getAgentStatusStyle,
  getEvalStatusStyle,
} from "../../status/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatAgentBadge } from "./badges.js";
import { renderTable } from "./table.js";

type AgentHeaderSource =
  | Pick<
      AgentInvocationEnhanced,
      "agentId" | "status" | "startedAt" | "completedAt"
    >
  | Pick<AgentReport, "agentId" | "status" | "startedAt" | "completedAt">;

type AgentSectionSource = AgentHeaderSource & {
  diffStatistics?: string;
  error?: string;
  warnings?: string[];
  baseDirectory?: string;
  runtimeManifestPath?: string;
  assets?: AgentInvocationEnhanced["assets"];
  evals?: (AgentEvalEnhanced | AgentEvalView)[];
};

export type AgentSectionInput = AgentSectionSource;

type AgentMetadataRow = {
  label: string;
  value: string;
};

export function formatAgentStatusLabel(status: AgentStatus): string {
  const statusColor = getAgentStatusStyle(status).cli;
  return colorize(status.toUpperCase(), statusColor);
}

export function buildAgentSectionHeader(agent: AgentHeaderSource): string {
  const agentLabel = formatAgentBadge(agent.agentId);
  const status = agent.status;
  const statusLabel = formatAgentStatusLabel(status);
  return `  ${agentLabel} ${statusLabel}`;
}

export function getAgentMetadata(
  agent: AgentSectionSource,
): AgentMetadataRow[] {
  const baseDir = agent.baseDirectory;
  const candidates = [
    { label: "Duration", value: formatAgentDuration(agent) },
    { label: "Changes", value: agent.diffStatistics },
    { label: "Root", value: baseDir },
  ];

  return candidates.filter(
    (row): row is AgentMetadataRow =>
      typeof row.value === "string" && row.value.length > 0,
  );
}

export function buildAgentMetadataSection(agent: AgentSectionSource): string[] {
  const metadata = getAgentMetadata(agent);

  if (metadata.length === 0) {
    return [];
  }

  const tableLines = renderTable({
    columns: [
      {
        header: "FIELD",
        accessor: (row: AgentMetadataRow) => row.label,
      },
      {
        header: "VALUE",
        accessor: (row: AgentMetadataRow) => row.value,
      },
    ],
    rows: metadata,
  });

  const [, ...bodyLines] = tableLines;
  return bodyLines;
}

export function buildAgentSection(agent: AgentSectionSource): string[] {
  const lines: string[] = [buildAgentSectionHeader(agent)];
  const agentRoot = getAgentRootPath(agent);

  const metadataLines = buildAgentMetadataSection(agent);
  if (metadataLines.length > 0) {
    lines.push("", ...indentLines(metadataLines));
  }

  const runtimeLines = buildAgentSectionRuntime(agent, agentRoot);
  if (runtimeLines.length > 0) {
    lines.push("", ...indentLines(runtimeLines));
  }

  if (agent.warnings && agent.warnings.length > 0) {
    const warningLines = agent.warnings.map((warning) =>
      colorize(`Warning: ${warning}`, "yellow"),
    );
    lines.push("", ...indentLines(warningLines));
  }

  if (agent.error) {
    lines.push("", ...indentLines([colorize(`Error: ${agent.error}`, "red")]));
  }

  const evalLines = buildAgentSectionEvals(agent, agentRoot);
  if (evalLines.length > 0) {
    lines.push("", ...indentLines(evalLines));
  }

  const artifactLines = buildAgentSectionArtifacts(agent, agentRoot);
  if (artifactLines.length > 0) {
    lines.push("", ...indentLines(artifactLines));
  }

  return lines;
}

export function buildAgentSectionArtifacts(
  agent: AgentSectionSource,
  agentRoot?: string,
): string[] {
  const labelValuePairs: Array<[string, string | undefined]> = [
    ["summary", agent.assets?.summaryPath],
    ["diff", agent.assets?.diffPath],
    ["chat", agent.assets?.chatPath],
    ["stdout", agent.assets?.stdoutPath],
    ["stderr", agent.assets?.stderrPath],
  ];

  const availablePairs = labelValuePairs.filter(
    (pair): pair is [string, string] => typeof pair[1] === "string",
  );

  if (availablePairs.length === 0) {
    return [];
  }

  const rows = availablePairs.map(([label, value]) => [
    label,
    relativizePath(value, agentRoot),
  ]);

  const tableLines = renderTable({
    columns: [
      {
        header: "ARTIFACT",
        accessor: (row) => row[0],
      },
      {
        header: "PATH",
        accessor: (row) => row[1],
      },
    ],
    rows,
  });

  return tableLines;
}

export function buildAgentSectionEvals(
  agent: AgentSectionSource,
  agentRoot?: string,
): string[] {
  const evalResults = agent.evals ?? [];
  const rows =
    evalResults.length === 0
      ? [
          {
            slug: "none",
            status: colorize("SKIPPED", getEvalStatusStyle("skipped").cli),
            log: "—",
          },
        ]
      : evalResults.map((evaluation) => ({
          slug: evaluation.slug,
          status: colorize(
            evaluation.status.toUpperCase(),
            getEvalStatusStyle(evaluation.status).cli,
          ),
          log:
            evaluation.logPath !== undefined
              ? relativizePath(evaluation.logPath, agentRoot)
              : "—",
        }));

  const tableLines = renderTable({
    columns: [
      { header: "EVAL", accessor: (row) => row.slug },
      { header: "STATUS", accessor: (row) => row.status },
      { header: "LOG", accessor: (row) => row.log },
    ],
    rows,
  });

  return tableLines;
}

export function buildAgentSectionRuntime(
  agent: AgentSectionSource,
  agentRoot?: string,
): string[] {
  const rows: Array<[string, string]> = [];

  if (
    typeof agent.runtimeManifestPath === "string" &&
    agent.runtimeManifestPath.length > 0
  ) {
    rows.push([
      "manifest",
      relativizePath(agent.runtimeManifestPath, agentRoot),
    ]);
  }

  const sandboxPath = deriveSandboxSettingsPath(agent);
  if (sandboxPath) {
    rows.push(["sandbox", relativizePath(sandboxPath, agentRoot)]);
  }

  if (rows.length === 0) {
    return [];
  }

  const tableLines = renderTable({
    columns: [
      {
        header: "RUNTIME",
        accessor: (row) => row[0],
      },
      {
        header: "PATH",
        accessor: (row) => row[1],
      },
    ],
    rows,
  });

  return tableLines;
}

export function formatAgentDuration(
  agent: AgentHeaderSource,
): string | undefined {
  const startedAt = safeParse(agent.startedAt);
  const completedAt = safeParse(agent.completedAt);

  if (
    startedAt === undefined ||
    completedAt === undefined ||
    completedAt < startedAt
  ) {
    return undefined;
  }

  const durationMs = completedAt - startedAt;
  return formatDurationLabel(durationMs);
}

function safeParse(timestamp: string | undefined): number | undefined {
  if (!timestamp) {
    return undefined;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

export function formatDurationLabel(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

function getAgentRootPath(agent: AgentSectionSource): string | undefined {
  if (typeof agent.baseDirectory === "string") {
    return agent.baseDirectory;
  }

  const assets = agent.assets;
  const candidates = [
    assets?.summaryPath,
    assets?.diffPath,
    assets?.stdoutPath,
    assets?.stderrPath,
  ].filter((value): value is string => typeof value === "string");

  for (const candidate of candidates) {
    const parent = parentDirectory(candidate);
    if (parent) {
      return stripWorkspaceSuffix(parent);
    }
  }

  return undefined;
}

function parentDirectory(path: string): string | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return undefined;
  }
  return segments.slice(0, -1).join("/");
}

function stripWorkspaceSuffix(path: string): string {
  return path.endsWith("/workspace") ? path.slice(0, -10) : path;
}

function deriveSandboxSettingsPath(
  agent: AgentSectionSource,
): string | undefined {
  if (
    typeof agent.baseDirectory === "string" &&
    agent.baseDirectory.length > 0
  ) {
    return `${stripTrailingSlash(agent.baseDirectory)}/runtime/sandbox.json`;
  }

  if (
    typeof agent.runtimeManifestPath === "string" &&
    agent.runtimeManifestPath.length > 0
  ) {
    const runtimeDir = parentDirectory(agent.runtimeManifestPath);
    if (runtimeDir) {
      return `${runtimeDir}/sandbox.json`;
    }
  }

  return undefined;
}

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function relativizePath(path: string, root?: string): string {
  if (!root) {
    return path;
  }

  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  if (path.startsWith(normalizedRoot)) {
    return path.slice(normalizedRoot.length);
  }

  return path;
}

function indentLines(lines: string[]): string[] {
  return lines.map((line) => (line.length > 0 ? `  ${line}` : line));
}
