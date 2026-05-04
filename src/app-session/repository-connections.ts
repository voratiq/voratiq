import { buildAppApiUrl, readAppApiError } from "./api-client.js";
import { runWithAuthenticatedAppSession } from "./authenticated-api.js";

export interface AppRepositoryConnectionEnsureRequest {
  local_repo_key: string;
  slug: string;
  display_name?: string;
  git_remote_fingerprint?: string;
  git_origin_url?: string;
}

export interface AppRepositoryConnectionEnsureResponse {
  repository_id: string;
  repository_connection_id: string;
  linked: boolean;
  created_repository: boolean;
  created_connection: boolean;
}

export interface EnsureAppRepositoryConnectionOptions {
  payload: AppRepositoryConnectionEnsureRequest;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

interface EnsureAppRepositoryConnectionDependencies {
  fetchImpl: typeof fetch;
  runWithAuthenticatedAppSession: typeof runWithAuthenticatedAppSession;
}

export async function ensureAppRepositoryConnection(
  options: EnsureAppRepositoryConnectionOptions,
  dependencies: Partial<EnsureAppRepositoryConnectionDependencies> = {},
): Promise<AppRepositoryConnectionEnsureResponse> {
  const env = options.env ?? process.env;
  const deps: EnsureAppRepositoryConnectionDependencies = {
    fetchImpl: fetch,
    runWithAuthenticatedAppSession,
    ...dependencies,
  };

  return await deps.runWithAuthenticatedAppSession({
    env,
    signal: options.signal,
    run: async ({ accessToken, signal }) => {
      const response = await deps.fetchImpl(
        buildAppApiUrl("account/repository-connections/ensure", {
          env,
        }),
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(options.payload),
          signal,
        },
      );

      if (!response.ok) {
        throw await readAppApiError(response);
      }

      return (await response.json()) as AppRepositoryConnectionEnsureResponse;
    },
  });
}
