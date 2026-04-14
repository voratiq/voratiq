# Voratiq

Run workflows, delegate to swarms, and verify outputs before you apply them.

Voratiq provides composable operators for structured multi-agent workflows, with durable artifacts and session history that keep each step inspectable as work unfolds.

## Installation

```bash
npm install -g voratiq
```

<details>
<summary>Requirements</summary>

- Node 20+
- git
- 1+ AI coding agent (Claude [>=2.1.63](https://github.com/anthropics/claude-code?tab=readme-ov-file#get-started), Codex [>=0.107.0](https://github.com/openai/codex?tab=readme-ov-file#quickstart), or Gemini [>=0.31.0](https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#quick-install))
- macOS: `ripgrep`
- Linux (Debian/Ubuntu): `bubblewrap`, `socat`, `ripgrep`

See the [sandbox runtime docs](https://github.com/anthropic-experimental/sandbox-runtime/blob/1bafa66a2c3ebc52569fc0c1a868e85e778f66a0/README.md#platform-specific-dependencies) for platform-specific dependencies.

Windows is not currently supported.

</details>

## Quick Start

From a git repo root, run:

```bash
voratiq
```

That opens an interactive agent session with access to Voratiq's operators.

From there, the agent can:

- run multi-step workflows with explicit stages
- delegate work to swarms of agents
- verify outputs before applying them
- use different workflow architectures for different tasks
- inspect session history and artifacts

For more information, see the [getting started](https://github.com/voratiq/voratiq/blob/main/docs/getting-started.md) guide.

## Documentation

Start here:

- [Getting Started](https://github.com/voratiq/voratiq/blob/main/docs/getting-started.md) - Which workflow to use and how to run it
- [How It Works](https://github.com/voratiq/voratiq/blob/main/docs/how-it-works.md) - Operators, verification, and artifacts
- [CLI Reference](https://github.com/voratiq/voratiq/blob/main/docs/cli-reference.md) - Commands and options
- [Troubleshooting](https://github.com/voratiq/voratiq/blob/main/docs/troubleshooting.md) - Common setup and runtime issues

Configuration:

- [Agents](https://github.com/voratiq/voratiq/blob/main/docs/configs/agents.md) - Agent catalog and invocation details
- [Environment](https://github.com/voratiq/voratiq/blob/main/docs/configs/environment.md) - Runtime dependencies for agent execution
- [Sandbox](https://github.com/voratiq/voratiq/blob/main/docs/configs/sandbox.md) - Network and filesystem restrictions
- [Orchestration](https://github.com/voratiq/voratiq/blob/main/docs/configs/orchestration.md) - Which agents participate at each workflow stage
- [Verification](https://github.com/voratiq/voratiq/blob/main/docs/configs/verification.md) - How verification is configured across stages

## License

Voratiq is available under the [MIT License](https://github.com/voratiq/voratiq/blob/main/LICENSE).
