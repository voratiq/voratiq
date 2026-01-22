---
title: Voratiq Documentation
---

# Voratiq

Voratiq helps you write software in a new way. Run coding agents against each other on real tasks, compare results, and merge the winner.

Write a spec in Markdown, run it against any number of agents (Claude, Codex, or Gemini), and let automated evals help determine which output is best.

## Quick Start

### Install

```bash
npm install -g voratiq
```

### Initialize

```bash
voratiq init
```

Creates `.voratiq/` with workspace scaffolding, agent catalog, and eval configs. Voratiq detects available agents on `$PATH` and seeds defaults you can customize by editing the generated YAML files.

**Note:** Voratiq does not install agent CLIs or manage authentication for you. You must install the CLIs you wish to use and authenticate with each provider before running specs. Missing binaries or stale credentials cause the run to fail immediately.

### Create a Spec

Generate a task specification in Markdown:

```bash
voratiq spec \
  --description "Fix authentication bug: users are logged out after 5 minutes instead of the configured session timeout. Sessions should respect SESSION_TIMEOUT_MS (default 30 minutes)." \
  --agent <agent-id> \
  --output .voratiq/specs/fix-auth-bug.md
```

An agent converts the description into a Markdown spec, giving the workflow a single source of truth for runs and evals.

### Run

```bash
voratiq run --spec .voratiq/specs/fix-auth-bug.md
```

Agents execute in parallel, each in its own sandboxed worktree. Voratiq captures stdout/stderr, code diffs, and eval results. Run metadata persists under `.voratiq/runs/sessions/<run-id>/`.

### Review

```bash
voratiq review --run <run-id> --agent <agent-id>
```

Runs the specified reviewer agent headlessly against the recorded run and writes its findings to `.voratiq/reviews/sessions/<review-id>/<agent-id>/artifacts/review.md`.

### Apply

```bash
voratiq apply --run <run-id> --agent <agent-id>
```

Applies the selected agent's diff using `git apply`.

### Prune

```bash
voratiq prune --run <run-id>
```

Removes run workspaces and branches. Use `--purge` to delete artifacts. Metadata remains in `.voratiq/runs/index.json` + `.voratiq/runs/sessions/<run-id>/record.json`.

## Documentation

- [Tutorial](https://github.com/voratiq/voratiq/blob/main/docs/tutorial.md) — End-to-end walkthrough
- [Core Concepts](https://github.com/voratiq/voratiq/blob/main/docs/core-concepts.md) — Mental model and design philosophy
- [CLI Reference](https://github.com/voratiq/voratiq/blob/main/docs/cli-reference.md) — All commands and options
- Configurations:
  - [Agents](https://github.com/voratiq/voratiq/blob/main/docs/configs/agents.md) — Define which agents run and how to invoke them
  - [Environment](https://github.com/voratiq/voratiq/blob/main/docs/configs/environment.md) — Configure runtime environments
  - [Evals](https://github.com/voratiq/voratiq/blob/main/docs/configs/evals.md) — Define checks that gate agent output
  - [Sandbox](https://github.com/voratiq/voratiq/blob/main/docs/configs/sandbox.md) — Network and filesystem restrictions
