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

  it("returns undefined for non-claude providers", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "voratiq-detector-"));
    const stdoutPath = join(scratch, "stdout.log");
    const stderrPath = join(scratch, "stderr.log");
    await writeFile(stdoutPath, "Invalid API key", "utf8");
    await writeFile(stderrPath, "Please run /login", "utf8");

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
