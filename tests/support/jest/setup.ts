import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.TERM) {
  process.env.TERM = "dumb";
}

// Ensure `git init` does not attempt to copy protected system templates (macOS/Xcode)
// into sandboxed temp repos during tests.
const gitTemplateDir =
  process.env.VORATIQ_TEST_GIT_TEMPLATE_DIR ??
  mkdtempSync(join(tmpdir(), "voratiq-git-template-"));
process.env.VORATIQ_TEST_GIT_TEMPLATE_DIR = gitTemplateDir;

const gitConfigGlobal =
  process.env.VORATIQ_TEST_GIT_CONFIG_GLOBAL ??
  join(gitTemplateDir, "gitconfig");
process.env.VORATIQ_TEST_GIT_CONFIG_GLOBAL = gitConfigGlobal;

process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";

writeFileSync(
  gitConfigGlobal,
  `[init]\n\ttemplatedir = ${gitTemplateDir}\n`,
  "utf8",
);
