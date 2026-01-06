---
title: Core Concepts
---

# Core Concepts

Voratiq is built around six ideas:

- [Parallel Comparison](#parallel-comparison) — Run multiple agents concurrently to compare approaches
- [Specs As the Source of Truth](#specs-as-the-source-of-truth) — Every run requires a Markdown spec that defines intent
- [Eval Supported Review](#eval-supported-review) — Automated checks help gauge agent performance
- [Sandboxed Execution](#sandboxed-execution) — Agents run with minimal permissions by default
- [Everything Is Auditable](#everything-is-auditable) — Complete audit trail preserved for every run
- [Open & Transparent](#open--transparent) — The entire stack is inspectable, modifiable, and community-owned

This document walks through each concept and explains how it shapes Voratiq's design.

## Parallel Comparison

Voratiq runs multiple agents concurrently against the same spec. Each agent receives identical instructions but may approach the problem differently based on its model, training, or configuration.

Running agents in parallel lets you compare model capabilities, test different prompting strategies, or hedge against any single agent's failure. Evals help you determine which outputs meet your quality bar.

Disable agents in the agent configuration or limit concurrency when you need results from only one agent.

See [Agent Configuration](https://github.com/voratiq/voratiq/blob/main/docs/configs/agents.md) for managing which agents run.

## Specs As the Source of Truth

Every run requires a Markdown spec via `--spec`. The spec defines the task, expected behavior, constraints, or any other context agents need. Voratiq converts the spec into a canonical prompt, ensuring all agents receive identical instructions.

Specs make intent explicit, runs reproducible, and outcomes auditable. They prevent drift between agents and provide a clear baseline for comparing results.

You can rerun the same spec against different agents or models to compare approaches, or replay a past run to debug unexpected behavior.

See [CLI Reference](https://github.com/voratiq/voratiq/blob/main/docs/cli-reference.md) for `voratiq run` usage.

## Eval Supported Review

After each agent finishes, Voratiq runs evals (tests, linters, build checks, custom scripts) in the agent's workspace. Non-zero exit codes mark the eval and agent as failed. Voratiq seeds a default eval set during `voratiq init` using heuristics to detect common tests, linters, and build commands.

Evals are automated ways of gauging agent performance, checking correctness, style, security, or any criteria you define. They don't replace manual review but help catch issues early.

Extend or replace the default eval set with custom scripts when needed.

See [Eval Configuration](https://github.com/voratiq/voratiq/blob/main/docs/configs/evals.md) for defining custom checks.

## Sandboxed Execution

Agents run with minimal permissions by default. Network access is limited to domains required for the agent binary to function, and filesystem writes are restricted to the agent's workspace and sandbox home (for logging and temporary files).

This security posture attempts to limit the scope of unexpected agent behavior (bugs, hallucinations, or malicious prompts) while still allowing agents to complete their work. Note that sandbox restrictions are not foolproof; exfiltration and other exploits remain possible, so treat agent runs with appropriate caution.

When your workflow requires additional access (external APIs, shared caches, package installation), you can relax restrictions via sandbox configuration.

See [Sandbox Configuration](https://github.com/voratiq/voratiq/blob/main/docs/configs/sandbox.md) for customizing network and filesystem policies.

## Everything Is Auditable

Voratiq preserves a complete audit trail for every run under `.voratiq/runs/sessions/<run-id>/`. Each run directory contains the base git revision, agent logs (stdout/stderr), generated diffs, eval results, and agent summaries.

Review any past run, inspect what an agent changed, understand why an eval failed, or compare multiple agents' approaches to the same spec. Nothing is lost or overwritten.

Example run directory:

```
.voratiq/runs/sessions/20251105-143022-abc123/
├── record.json             # Run metadata (status, agents, timestamps)
├── claude-sonnet-4-5-20250929/
│   ├── artifacts/          # Harvested outputs
│   │   ├── diff.patch      # Git diff of all changes made by the agent
│   │   ├── stdout.log      # Agent's standard output stream
│   │   ├── stderr.log      # Agent's standard error stream
│   │   └── summary.txt     # Agent-written summary of what changed and why
│   ├── evals/              # Eval execution logs (one file per eval)
│   ├── runtime/            # Agent invocation details
│   │   ├── manifest.json   # Binary path, argv, env vars, workspace path
│   │   └── sandbox.json    # Applied network and filesystem policies
│   ├── sandbox/            # Sandbox home (logs, temp files)
│   └── workspace/          # Agent's git worktree (preserved for inspection)
├── gpt-5-1-codex/
│   ├── artifacts/
│   ├── evals/
│   ├── runtime/
│   └── workspace/
└── gemini-2-5-pro/
    ├── artifacts/
    ├── evals/
    ├── runtime/
    └── workspace/
```

Each agent directory follows the same structure, keeping runs consistent and easy to navigate.

Note: Voratiq does not persist a run-level `prompt.txt`. It generates the canonical prompt from the spec at runtime, writes it to ephemeral runtime files, and removes those files when execution completes.

## Open & Transparent

Voratiq is fully open source. The CLI, orchestration layers, sandbox policies, and agent presets live in this repository. You can inspect every line, propose changes, or fork the workflow to match your stack.

Open design lets you verify behavior, audit security decisions, and adapt the tool to your environment. All runs execute locally. You control where artifacts are stored, who accesses them, and when they're deleted.

Configuration is stored in plain text (YAML, JSON, Markdown). Add new agents, wire in custom evals, or swap sandbox rules by editing config files.

See the [Voratiq repository](https://github.com/voratiq/voratiq) for source code and contribution guidance.
