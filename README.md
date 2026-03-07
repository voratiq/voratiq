# Voratiq

Agent ensembles to design, generate, and select the best implementation for every task.

![`voratiq auto --spec .voratiq/specs/categorical-performance-by-taxonomy.md`](https://raw.githubusercontent.com/voratiq/voratiq/main/assets/run-demo.png)

No single model wins every task. Run several, keep the best result. [Here's why that works](https://voratiq.com/blog/selection-rather-than-prediction/).

## Installation

Install via npm:

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

See the [sandbox runtime docs](https://github.com/anthropic-experimental/sandbox-runtime/blob/1bafa66a2c3ebc52569fc0c1a868e85e778f66a0/README.md#platform-specific-dependencies) for guidance on the platform-specific dependencies.

Windows is not currently supported.

</details>

## Quick Start

Get started with a single command:

```bash
voratiq --description "add dark mode toggle with localStorage persistence"
```

This uses ensembles to:

- draft the spec
- generate candidate implementations
- select the best result through evals and review

## Documentation

Start here:

- [Tutorial](https://github.com/voratiq/voratiq/blob/main/docs/tutorial.md) - End-to-end walkthrough
- [CLI Reference](https://github.com/voratiq/voratiq/blob/main/docs/cli-reference.md) - Commands and options
- [Core Concepts](https://github.com/voratiq/voratiq/blob/main/docs/core-concepts.md) - Workflow model and design rationale

Configuration:

- [Agents](https://github.com/voratiq/voratiq/blob/main/docs/configs/agents.md) - Agent catalog and invocation details
- [Orchestration](https://github.com/voratiq/voratiq/blob/main/docs/configs/orchestration.md) - Which agents run at each stage
- [Evals](https://github.com/voratiq/voratiq/blob/main/docs/configs/evals.md) - Checks that gate candidate output
- [Environment](https://github.com/voratiq/voratiq/blob/main/docs/configs/environment.md) - Runtime dependencies for agents
- [Sandbox](https://github.com/voratiq/voratiq/blob/main/docs/configs/sandbox.md) - Network and filesystem restrictions

## License

Voratiq is available under the [MIT License](https://github.com/voratiq/voratiq/blob/main/LICENSE).
