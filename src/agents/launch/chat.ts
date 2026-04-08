import {
  preserveProviderChatTranscripts,
  type ProviderTranscriptBaseline,
  type ProviderTranscriptSelectionHint,
  snapshotProviderTranscripts,
} from "../../workspace/chat/artifacts.js";
import type { ChatArtifactFormat } from "../../workspace/chat/types.js";

export interface LaunchArtifactCaptureResult {
  readonly captured: boolean;
  readonly format?: ChatArtifactFormat;
  readonly artifactPath?: string;
  readonly sourceCount?: number;
  readonly error?: unknown;
}

export interface LaunchArtifactCaptureContext {
  readonly searchEnv?: NodeJS.ProcessEnv;
  readonly baseline?: ProviderTranscriptBaseline;
  readonly selectionHint?: ProviderTranscriptSelectionHint;
}

export async function prepareProviderArtifactCaptureContext(options: {
  providerId: string | undefined;
  sessionRoot: string;
  searchEnv?: NodeJS.ProcessEnv;
  selectionHint?: ProviderTranscriptSelectionHint;
}): Promise<LaunchArtifactCaptureContext | undefined> {
  const providerId = options.providerId ?? "";
  if (!providerId) {
    return undefined;
  }

  return {
    searchEnv: options.searchEnv,
    baseline: await snapshotProviderTranscripts({
      providerId,
      agentRoot: options.sessionRoot,
      searchEnv: options.searchEnv,
    }),
    selectionHint: options.selectionHint,
  };
}

export async function collectProviderArtifacts(options: {
  providerId: string | undefined;
  sessionRoot: string;
  captureContext?: LaunchArtifactCaptureContext;
}): Promise<LaunchArtifactCaptureResult> {
  const providerId = options.providerId ?? "";
  if (!providerId) {
    return { captured: false };
  }

  const result = await preserveProviderChatTranscripts({
    providerId,
    agentRoot: options.sessionRoot,
    searchEnv: options.captureContext?.searchEnv,
    baseline: options.captureContext?.baseline,
    selectionHint: options.captureContext?.selectionHint,
  });

  const format: ChatArtifactFormat | undefined = result.format;
  if (
    (result.status === "captured" || result.status === "already-exists") &&
    format
  ) {
    return {
      captured: true,
      format,
      artifactPath: result.artifactPath,
      sourceCount: result.sourceCount,
    };
  }

  if (result.status === "not-found") {
    return { captured: false };
  }

  return {
    captured: false,
    error: result.status === "error" ? result.error : undefined,
  };
}
