import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export class AppSignInCallbackError extends Error {
  constructor(
    readonly code:
      | "bind_failed"
      | "timed_out"
      | "state_mismatch"
      | "malformed_callback",
    message: string,
  ) {
    super(message);
    this.name = "AppSignInCallbackError";
  }
}

export interface AppSignInCallbackResult {
  code: string;
}

export interface AppSignInCallbackServer {
  callbackUrl: string;
  waitForResult(timeoutMs: number): Promise<AppSignInCallbackResult>;
  close(): Promise<void>;
}

function redirectResponse(response: ServerResponse, location: string) {
  response.statusCode = 303;
  response.setHeader("connection", "close");
  response.setHeader("location", location);
  response.end();
}

function buildCompletionUrl(
  completionUrl: string,
  status: "success" | "failed",
  reason?: "not_found" | "state_mismatch" | "malformed_callback",
) {
  const url = new URL(completionUrl);
  if (status !== "success") {
    url.searchParams.set("status", status);
  }
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return url.toString();
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startAppSignInCallbackServer(options: {
  expectedState: string;
  completionUrl: string;
  host?: string;
  pathname?: string;
  port?: number;
}): Promise<AppSignInCallbackServer> {
  const host = options.host ?? "127.0.0.1";
  const pathname = options.pathname ?? "/callback";
  const port = options.port ?? 0;

  let resolved = false;
  let resolveResult: ((result: AppSignInCallbackResult) => void) | null = null;
  let rejectResult: ((error: AppSignInCallbackError) => void) | null = null;

  const resultPromise = new Promise<AppSignInCallbackResult>(
    (resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    },
  );

  async function settleWithError(error: AppSignInCallbackError) {
    if (resolved) {
      return;
    }
    resolved = true;
    await closeServer(server).catch(() => {});
    rejectResult?.(error);
  }

  async function settleWithResult(result: AppSignInCallbackResult) {
    if (resolved) {
      return;
    }
    resolved = true;
    await closeServer(server).catch(() => {});
    resolveResult?.(result);
  }

  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? pathname, `http://${host}`);

      if (url.pathname !== pathname) {
        redirectResponse(
          response,
          buildCompletionUrl(options.completionUrl, "failed", "not_found"),
        );
        return;
      }

      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      if (state !== options.expectedState) {
        redirectResponse(
          response,
          buildCompletionUrl(options.completionUrl, "failed", "state_mismatch"),
        );
        void settleWithError(
          new AppSignInCallbackError(
            "state_mismatch",
            "The browser callback state did not match the active login request.",
          ),
        );
        return;
      }

      if (!code) {
        redirectResponse(
          response,
          buildCompletionUrl(
            options.completionUrl,
            "failed",
            "malformed_callback",
          ),
        );
        void settleWithError(
          new AppSignInCallbackError(
            "malformed_callback",
            "The browser callback did not include a usable exchange code.",
          ),
        );
        return;
      }

      redirectResponse(
        response,
        buildCompletionUrl(options.completionUrl, "success"),
      );
      void settleWithResult({ code });
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => {
      reject(
        new AppSignInCallbackError(
          "bind_failed",
          error instanceof Error
            ? error.message
            : "Failed to bind the localhost callback server.",
        ),
      );
    });
    server.listen(port, host, () => {
      server.removeAllListeners("error");
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new AppSignInCallbackError(
      "bind_failed",
      "Failed to resolve the localhost callback address.",
    );
  }

  return {
    callbackUrl: `http://${host}:${address.port}${pathname}`,
    async waitForResult(timeoutMs: number) {
      let timeoutHandle: NodeJS.Timeout | undefined;

      try {
        return await Promise.race([
          resultPromise,
          new Promise<AppSignInCallbackResult>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(
                new AppSignInCallbackError(
                  "timed_out",
                  "Timed out waiting for the browser to finish login approval.",
                ),
              );
              void closeServer(server).catch(() => {});
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    },
    async close() {
      await closeServer(server);
    },
  };
}
