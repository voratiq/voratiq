import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

import { describe, expect, it } from "@jest/globals";

describe("bundled MCP binary smoke", () => {
  it("serves framed stdio responses from dist/bin.js and exits on stdin close", async () => {
    const child = spawn(
      process.execPath,
      [resolve("dist/bin.js"), "mcp", "--stdio"],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
        },
      },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const responsePromise = collectFramedResponses(child.stdout, 3);

    child.stdin.write(
      toFramedJson({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
        },
      }),
    );
    child.stdin.write(
      toFramedJson({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    );
    child.stdin.write(
      toFramedJson({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    );
    child.stdin.end();

    const responses = await responsePromise;
    const [code, signal] = (await once(child, "close")) as [
      number | null,
      NodeJS.Signals | null,
    ];

    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(stderr).toBe("");

    const initialize = responses[0] as {
      result: {
        protocolVersion: string;
        capabilities: {
          tools: {
            listChanged: boolean;
          };
        };
        serverInfo: { name: string };
      };
    };
    expect(initialize.result.protocolVersion).toBe("2025-11-25");
    expect(initialize.result.capabilities.tools.listChanged).toBe(true);
    expect(initialize.result.serverInfo.name).toBe("voratiq");

    const toolsChanged = responses[1] as {
      jsonrpc: string;
      method: string;
    };
    expect(toolsChanged.jsonrpc).toBe("2.0");
    expect(toolsChanged.method).toBe("notifications/tools/list_changed");

    const toolList = responses[2] as {
      result: { tools: Array<{ name: string }> };
    };
    expect(toolList.result.tools.map((tool) => tool.name)).toEqual([
      "voratiq_spec",
      "voratiq_run",
      "voratiq_message",
      "voratiq_reduce",
      "voratiq_verify",
      "voratiq_apply",
      "voratiq_prune",
      "voratiq_list",
    ]);
  }, 120_000);
});

function toFramedJson(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`);
  return Buffer.concat([header, body]);
}

async function collectFramedResponses(
  stream: NodeJS.ReadableStream,
  expectedCount: number,
): Promise<unknown[]> {
  return await new Promise<unknown[]>((resolvePromise, rejectPromise) => {
    let buffer = Buffer.alloc(0);
    const messages: unknown[] = [];

    const cleanup = (): void => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
    };

    const onError = (error: Error): void => {
      cleanup();
      rejectPromise(error);
    };

    const onEnd = (): void => {
      if (messages.length >= expectedCount) {
        cleanup();
        resolvePromise(messages);
        return;
      }
      cleanup();
      rejectPromise(
        new Error(
          `Expected ${expectedCount} responses, received ${messages.length}.`,
        ),
      );
    };

    const onData = (chunk: Buffer | string): void => {
      buffer = Buffer.concat([
        buffer,
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
      ]);

      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          break;
        }
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const contentLengthLine = header
          .split("\r\n")
          .find((line) => line.toLowerCase().startsWith("content-length:"));
        if (!contentLengthLine) {
          cleanup();
          rejectPromise(
            new Error("Missing Content-Length header in response frame."),
          );
          return;
        }
        const contentLength = Number(contentLengthLine.split(":")[1]?.trim());
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          cleanup();
          rejectPromise(new Error("Invalid Content-Length in response frame."));
          return;
        }
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (buffer.length < bodyEnd) {
          break;
        }
        const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
        messages.push(JSON.parse(body) as unknown);
        buffer = buffer.subarray(bodyEnd);
      }

      if (messages.length >= expectedCount) {
        cleanup();
        resolvePromise(messages);
      }
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
