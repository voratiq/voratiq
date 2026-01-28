import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../../../src/agents/runtime/failures.js";
import { CLAUDE_OAUTH_RELOGIN_HINT } from "../../../../src/auth/providers/claude/constants.js";

describe("detectAgentProcessFailureDetail", () => {
  it("returns Claude reauth hint when logs ask to run /login", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "Invalid API key · Please run /login", "utf8");
    await writeFile(stderrPath, "", "utf8");

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "claude",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe(CLAUDE_OAUTH_RELOGIN_HINT);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("returns Claude hint for catalog variants when provider matches", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(
      stderrPath,
      "Credentials invalid. Please run /login",
      "utf8",
    );

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "claude",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe(CLAUDE_OAUTH_RELOGIN_HINT);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("returns Claude hint when OAuth token has expired", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(stderrPath, "OAuth token has expired", "utf8");

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "claude",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe(CLAUDE_OAUTH_RELOGIN_HINT);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("returns undefined for unsupported providers", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "Invalid API key", "utf8");
    await writeFile(stderrPath, "Please run /login", "utf8");

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "unknown-provider",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBeUndefined();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("extracts Gemini message from JSON error blobs", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(
      stderrPath,
      '{"error":{"code":403,"message":"PERMISSION_DENIED: API key invalid"}}',
      "utf8",
    );

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "gemini",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe("PERMISSION_DENIED: API key invalid");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("extracts Gemini fallback line when message is unavailable", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "ok", "utf8");
    await writeFile(
      stderrPath,
      [
        "some warning",
        "RESOURCE_EXHAUSTED: quota exceeded",
        "PERMISSION_DENIED: should not win because later",
      ].join("\n"),
      "utf8",
    );

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "gemini",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe("RESOURCE_EXHAUSTED: quota exceeded");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("skips placeholder JSON messages and falls back to a capacity line", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(
      stdoutPath,
      '{"error":{"message":"[object Object]"}}',
      "utf8",
    );
    await writeFile(
      stderrPath,
      "You have exhausted your capacity on this model. Your quota will reset after 1h.",
      "utf8",
    );

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "gemini",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe(
        "You have exhausted your capacity on this model. Your quota will reset after 1h.",
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("extracts a concise Gemini quota error from a long prefix line", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(
      stderrPath,
      "Error when talking to Gemini API Full report available at: /tmp/claude/gemini-client-error.json TerminalQuotaError: You have exhausted your capacity on this model. Your quota will reset after 12h14m48s.",
      "utf8",
    );

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "gemini",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe(
        "TerminalQuotaError: You have exhausted your capacity on this model. Your quota will reset after 12h14m48s.",
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("extracts Codex message from JSON payloads", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(
      stdoutPath,
      '{"error":{"type":"invalid_request_error","message":"unsupported_value: model"}}',
      "utf8",
    );
    await writeFile(stderrPath, "", "utf8");

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "codex",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe("unsupported_value: model");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("extracts Codex fallback line when message is unavailable", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(
      stdoutPath,
      ["starting", "thread 'main' panicked at 'boom'"].join("\n"),
      "utf8",
    );
    await writeFile(stderrPath, "", "utf8");

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "codex",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBe("thread 'main' panicked at 'boom'");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("returns undefined for Codex when no high-signal pattern matches", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "FAILED: exit 1", "utf8");
    await writeFile(stderrPath, "something went wrong", "utf8");

    try {
      const detail = await detectAgentProcessFailureDetail({
        provider: "codex",
        stdoutPath,
        stderrPath,
      });
      expect(detail).toBeUndefined();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
