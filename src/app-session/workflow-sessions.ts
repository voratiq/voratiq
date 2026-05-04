import { buildAppApiUrl, readAppApiError } from "./api-client.js";
import { runWithAuthenticatedAppSession } from "./authenticated-api.js";

export type AppWorkflowSessionPayload = Readonly<Record<string, unknown>>;

export type AppWorkflowSessionResponse = Record<string, unknown>;

export interface CreateAppWorkflowSessionOptions {
  payload: AppWorkflowSessionPayload;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

interface CreateAppWorkflowSessionDependencies {
  fetchImpl: typeof fetch;
  runWithAuthenticatedAppSession: typeof runWithAuthenticatedAppSession;
}

export async function createAppWorkflowSession<
  ResponseJson extends AppWorkflowSessionResponse = AppWorkflowSessionResponse,
>(
  options: CreateAppWorkflowSessionOptions,
  dependencies: Partial<CreateAppWorkflowSessionDependencies> = {},
): Promise<ResponseJson> {
  const env = options.env ?? process.env;
  const deps: CreateAppWorkflowSessionDependencies = {
    fetchImpl: fetch,
    runWithAuthenticatedAppSession,
    ...dependencies,
  };

  return await deps.runWithAuthenticatedAppSession<ResponseJson>({
    env,
    signal: options.signal,
    run: async ({ accessToken, signal }) => {
      const response = await deps.fetchImpl(
        buildAppApiUrl("account/workflow-sessions", {
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

      return (await response.json()) as ResponseJson;
    },
  });
}
