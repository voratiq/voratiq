import { describe, expect, it } from "@jest/globals";

import {
  createTeardownController,
  registerScratchWorkspaceTeardownPaths,
} from "../../../src/competition/shared/teardown.js";

describe("registerScratchWorkspaceTeardownPaths", () => {
  it("registers scratch workspace paths with stable labels", () => {
    const teardown = createTeardownController("test");

    registerScratchWorkspaceTeardownPaths(
      teardown,
      {
        workspacePath: "/tmp/workspace",
        contextPath: "/tmp/context",
        runtimePath: "/tmp/runtime",
        sandboxPath: "/tmp/sandbox",
      },
      "agent-a",
    );

    expect(teardown.listResources()).toEqual([
      {
        kind: "path",
        path: "/tmp/workspace",
        label: "agent-a workspace",
      },
      {
        kind: "path",
        path: "/tmp/context",
        label: "agent-a context",
      },
      {
        kind: "path",
        path: "/tmp/runtime",
        label: "agent-a runtime",
      },
      {
        kind: "path",
        path: "/tmp/sandbox",
        label: "agent-a sandbox",
      },
    ]);
  });
});
