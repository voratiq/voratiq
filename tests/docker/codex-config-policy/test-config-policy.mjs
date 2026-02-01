import fs from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// stageAgentAuth is implemented in src/agents/runtime/auth.ts
import {
  stageAgentAuth,
  teardownAuthContext,
} from "../../../dist/agents/runtime/auth.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCase({ name, rootDir, expectConfigToml, runtime, agent }) {
  const agentRoot = path.join(rootDir, "agent");
  await mkdir(agentRoot, { recursive: true });

  const result = await stageAgentAuth({
    agent,
    agentRoot,
    root: rootDir,
    runId: name,
    runtime,
  });

  const sandboxPath = result.context.sandboxPath;
  const authPath = path.join(sandboxPath, ".codex", "auth.json");
  const configPath = path.join(sandboxPath, ".codex", "config.toml");

  assert(fs.existsSync(authPath), `${name}: expected ${authPath} to be staged`);

  if (expectConfigToml) {
    assert(
      fs.existsSync(configPath),
      `${name}: expected ${configPath} to be staged`,
    );
  } else {
    assert(
      !fs.existsSync(configPath),
      `${name}: expected ${configPath} to NOT be staged`,
    );
  }

  await teardownAuthContext(result.context);
}

const tempBase = await mkdtemp(
  path.join(os.tmpdir(), "voratiq-codex-config-policy-"),
);

const codexHome = path.join(tempBase, "codex-home");
await mkdir(codexHome, { recursive: true });

await writeFile(
  path.join(codexHome, "auth.json"),
  JSON.stringify({ access_token: "fake-token", token_type: "bearer" }),
  "utf8",
);

await writeFile(
  path.join(codexHome, "config.toml"),
  'model_reasoning_effort = "high"\n',
  "utf8",
);

const runtime = {
  platform: process.platform,
  env: { ...process.env, CODEX_HOME: codexHome },
  homeDir: os.homedir(),
  username: os.userInfo().username,
};

const agent = {
  id: "codex-test",
  provider: "codex",
  model: "test-model",
  binary: "codex",
  argv: ["codex"],
};

console.error("[voratiq] Running default policy case...");
const defaultRoot = path.join(tempBase, "case-default");
await mkdir(defaultRoot, { recursive: true });
await runCase({
  name: "default-policy",
  rootDir: defaultRoot,
  expectConfigToml: false,
  runtime,
  agent,
});

console.error("[voratiq] Running ignore policy case...");
const ignoreRoot = path.join(tempBase, "case-ignore");
await mkdir(ignoreRoot, { recursive: true });

await mkdir(path.join(ignoreRoot, ".voratiq"), { recursive: true });
await writeFile(
  path.join(ignoreRoot, ".voratiq", "settings.yaml"),
  "codex:\n  globalConfigPolicy: ignore\n",
  "utf8",
);

await runCase({
  name: "ignore-policy",
  rootDir: ignoreRoot,
  expectConfigToml: false,
  runtime,
  agent,
});

console.error("[voratiq] OK");
