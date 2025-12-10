# Voratiq

Run multiple AI coding agents in parallel, compare their results, and apply the best solution.

![`voratiq run --spec specs/p1/agent-workspace-guardrails.md`](https://raw.githubusercontent.com/voratiq/voratiq/main/assets/run-demo.png)

## Installation

Voratiq is in public beta. Install via npm:

```bash
npm install -g voratiq@beta
```

### Requirements

Core:

- Node 20+
- git
- 1+ AI coding agent (Claude [(>=2.0.55)](https://github.com/anthropics/claude-code?tab=readme-ov-file#get-started), Codex [(>=0.66.0)](https://github.com/openai/codex?tab=readme-ov-file#quickstart), or Gemini [(>=0.19.4)](https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#quick-install))

Platform-specific:

- macOS: `ripgrep`
- Linux (Debian/Ubuntu): `bubblewrap`, `socat`, `ripgrep`

See the [sandbox runtime docs](https://github.com/anthropic-experimental/sandbox-runtime/blob/1bafa66a2c3ebc52569fc0c1a868e85e778f66a0/README.md#platform-specific-dependencies) for installation instructions.

Note: Windows is not currently supported.

## Quick Start

```bash
# Initialize workspace
voratiq init

# Write a spec
cat > specs/fix-auth.md <<EOF
# Fix Session Timeout Bug
Users are logged out after 5 minutes instead of 30.
Sessions should honor SESSION_TIMEOUT_MS (default 30 minutes).
EOF

# Run agents in parallel
voratiq run --spec specs/fix-auth.md

# Review results
voratiq review --run <run-id>

# Apply the best solution
voratiq apply --run <run-id> --agent <agent-id>
```

See the [docs](https://github.com/voratiq/voratiq/blob/main/docs/index.md) for core concepts, CLI reference, and guides on configuring agents, evals, runtime environments, and sandbox restrictions.

## License

Voratiq is available under the [MIT License](https://github.com/voratiq/voratiq/blob/main/LICENSE).
