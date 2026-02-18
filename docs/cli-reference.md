---
title: CLI Reference
---

# CLI Reference

Complete reference for all Voratiq commands.

## Global Behavior

- Running `voratiq` without arguments prints help
- Commands exit with code 1 on operational errors
- Most commands expect `.voratiq/` to exist (created via `voratiq init`)
- Transcripts stream to stdout; stderr is reserved for warnings and errors

## `voratiq init`

Bootstrap workspace scaffolding in the current repository.

### Usage

```bash
voratiq init [--preset pro|lite|manual] [-y, --yes]
```

### Options

- `-y, --yes`: Assume yes and accept defaults (suppresses prompts; useful for CI/scripts)
- `--preset <preset>`: Select a preset (`pro|lite|manual`, default: `pro`)

### Behavior

Creates:

- `.voratiq/` directory
- `specs/`, `runs/`, and `reviews/` directories
- `agents.yaml` with the full supported agent catalog (binary paths filled for CLIs found on `$PATH`)
- `orchestration.yaml` with stage-to-agent assignments based on the selected preset
- `environment.yaml` with environment settings
- `evals.yaml` with common eval commands
- `sandbox.yaml` with sandbox policies
- `index.json` files under `specs/`, `runs/`, and `reviews/`

If `.voratiq/` already exists, `voratiq init` fills any missing files and directories.

Interactive mode (TTY) prompts for confirmation. Non-TTY environments require the `--yes` flag.

### Examples

```bash
# Interactive mode (prompts for confirmation)
voratiq init

# Non-interactive mode (skip prompts)
voratiq init -y

# Use faster default models
voratiq init --preset lite

# Start with an empty agents.yaml (configure agents yourself)
voratiq init --preset manual --yes
```

### Errors

- Repository is not a git repo
- Insufficient permissions to create files

## `voratiq spec`

Generate a structured spec from a task description via a sandboxed agent.

### Usage

```bash
voratiq spec --description <text> [--agent <agent-id>] [--profile <name>] [--title <text>] [--output <path>]
```

### Options

- `--description <text>`: Task description for the spec (required)
- `--agent <agent-id>`: Agent to draft the spec (uses orchestration config if omitted)
- `--profile <name>`: Orchestration profile used for `spec` stage resolution (default: `default`)
- `--title <text>`: Spec title; agent infers if omitted
- `--output <path>`: Output path; agent infers if omitted (default: `.voratiq/specs/<slug>.md`)

### Behavior

Invokes the specified agent in a sandbox to draft a structured Markdown spec from the provided description.

### Examples

```bash
$ voratiq spec --description "add dark mode toggle with localStorage persistence" --agent claude-opus-4-5-20251101

Generating specification...

Spec saved: .voratiq/specs/add-dark-mode-toggle.md

To begin a run:
  voratiq run --spec .voratiq/specs/add-dark-mode-toggle.md
```

### Errors

- Missing required flags
- Agent not found
- No agent found for spec stage (stage config empty and no `--agent`)
- Multiple agents found for spec stage (multi-agent spec is not supported)
- Output path already exists
- Specification generation failed

## `voratiq run`

Execute agents against a Markdown spec.

### Usage

```bash
voratiq run --spec <path> [--agent <agent-id>]... [--profile <name>] [--max-parallel <count>] [--branch]
```

### Options

- `--spec <path>`: Path to the Markdown spec file (required)
- `--agent <agent-id>`: Agent identifier override (repeatable; preserves CLI order). Uses orchestration config if omitted.
- `--profile <name>`: Orchestration profile used for `run` stage resolution (default: `default`)
- `--max-parallel <count>`: Maximum number of agents to run concurrently (default: all agents)
- `--branch`: Checkout or create a branch named after the spec file

### Behavior

1. Validates clean git tree, spec exists, agent/eval configs are valid
2. Generates run ID, creates run workspace, initializes run record
3. Spawns agents, each in an isolated git worktree
4. Runs evals in each agent's workspace after the agent completes
5. Captures diffs, persists records, generates report

Exits with code 1 if:

- Preflight checks fail
- No agents found for the stage
- Any agent fails or errors

Eval failures are quality signals displayed in the output but do not affect exit code.

### Examples

```bash
# Run agents against a spec
voratiq run --spec .voratiq/specs/fix-auth-bug.md

# Limit concurrency to 2 agents at a time
voratiq run --spec .voratiq/specs/refactor.md --max-parallel 2
```

### Errors

- Git working tree is not clean
- Spec file doesn't exist
- No agents found for the stage (empty orchestration config and no `--agent` override)
- Agent binary not found or not executable
- Stale or missing agent credentials
- Invalid agent/eval configuration

## `voratiq review`

Run a reviewer agent against a recorded run.

### Usage

```bash
voratiq review --run <run-id> [--agent <agent-id>] [--profile <name>]
```

### Options

- `--run <run-id>`: Run ID to review (required)
- `--agent <agent-id>`: Reviewer agent identifier (uses orchestration config if omitted)
- `--profile <name>`: Orchestration profile used for `review` stage resolution (default: `default`)

### Behavior

Invokes the specified agent in a sandbox to analyze artifacts from a completed run and write a review.

### Examples

```bash
voratiq review --run 20251031-232802-abc123 --agent gpt-5-2-codex
```

### Errors

- Run ID not found
- Run record is malformed
- No agent found for review stage (stage config empty and no `--agent`)
- Multiple agents found for review stage (multi-agent review is not supported)
- Run artifacts are missing (warns but continues)

## `voratiq apply`

Apply a specific agent's diff to the repository using `git apply`.

### Usage

```bash
voratiq apply --run <run-id> --agent <agent-id> [--ignore-base-mismatch] [--commit]
```

### Options

- `--run <run-id>`: Run ID containing the agent (required)
- `--agent <agent-id>`: Agent ID whose diff to apply (required)
- `--ignore-base-mismatch`: Skip base revision check (apply even if current HEAD differs from run's base)
- `--commit`: Create a git commit after a successful apply, using the agent's summary as the commit message

### Behavior

1. Validates git working tree is clean
2. Loads the agent's diff from `.voratiq/runs/sessions/<run-id>/<agent-id>/artifacts/diff.patch`
3. Compares current `HEAD` to the run's base revision; exits with a base mismatch error unless `--ignore-base-mismatch` is provided
4. Executes `git apply <diff.patch>`

Common `git apply` failures:

- Base mismatch: Current HEAD differs from the run's base (resolve conflicts manually or use `--ignore-base-mismatch`)
- Conflicts: Diff doesn't apply cleanly (resolve manually)
- Generic error: Something else went wrong (check git status)

### Examples

```bash
# Apply agent's diff (with base check)
voratiq apply --run 20251031-232802-abc123 --agent gpt-5-2-xhigh

# Apply diff, ignoring base mismatch
voratiq apply --run 20251031-232802-abc123 --agent gpt-5-2-xhigh --ignore-base-mismatch
```

### Errors

- Run or agent not found
- Git working tree is not clean
- Base revision mismatch (without `--ignore-base-mismatch`)
- `git apply` fails (conflicts or other errors)

## `voratiq list`

Display recorded runs with optional filtering.

### Usage

```bash
voratiq list [--limit <n>] [--spec <path>] [--run <run-id>] [--include-pruned]
```

### Options

- `--limit <n>`: Show only the N most recent runs (default: 10)
- `--spec <path>`: Filter by spec path
- `--run <run-id>`: Show only the specified run ID
- `--include-pruned`: Include runs marked as pruned

### Behavior

Renders a table of recorded runs with run ID, status, spec path, and creation timestamp.

### Examples

```bash
# List recent runs (default: last 10, excludes pruned)
voratiq list

# List runs for a specific spec
voratiq list --spec .voratiq/specs/fix-auth-bug.md

# Show a specific run
voratiq list --run 20251031-232802-abc123

# Include pruned runs
voratiq list --include-pruned
```

### Errors

- Run records are malformed

## `voratiq prune`

Remove run workspaces and mark the run as pruned in records (use `--purge` to delete artifacts).

### Usage

```bash
voratiq prune (--run <run-id> | --all) [--purge] [-y, --yes]
```

### Options

- `--run <run-id>`: Run ID to prune (required)
- `--all`: Prune all non-pruned runs
- `--purge`: Delete all associated configs and artifacts
- `-y, --yes`: Skip interactive confirmations

### Behavior

1. Loads the run record
2. Displays a summary of workspaces, artifacts, and branches slated for deletion and requests confirmation (unless `-y/--yes`)
3. Deletes run worktrees and, when `--purge` is set, all associated configs and artifacts
4. Updates run record, marking it as pruned

`--purge` broadens what is removed but still prompts for confirmation; combine with `-y` for non-interactive execution.

### Examples

```bash
# Interactive pruning
voratiq prune --run 20251031-232802-abc123

# Non-interactive (skip prompts)
voratiq prune --run 20251031-232802-abc123 -y

# Fully purge the run directory (non-interactively)
voratiq prune --run 20251031-232802-abc123 --purge -y
```

### Errors

- Run ID not found
- Artifacts already deleted
- Insufficient permissions to delete files
