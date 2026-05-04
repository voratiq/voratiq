import { runWithAuthenticatedAppSession } from "../../src/app-session/authenticated-api.js";

export function readRequestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }
  return init.body;
}

export function createAuthenticatedRunner(
  dependencies: Parameters<typeof runWithAuthenticatedAppSession>[1],
) {
  return async <Result>(
    options: Parameters<typeof runWithAuthenticatedAppSession<Result>>[0],
  ) => await runWithAuthenticatedAppSession(options, dependencies);
}
