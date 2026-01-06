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
voratiq init [-y, --yes]
```

### Options

- `-y, --yes`: Skip interactive confirmations (useful for CI/scripts)

### Behavior

Creates:

- `.voratiq/` directory
- `runs/` and subdirectories for run data (including `runs/sessions/`)
- `specs/` and subdirectories for spec data (including `specs/sessions/`)
- `reviews/` and subdirectories for review data (including `reviews/sessions/`)
- `agents.yaml` with detected agent binaries
- `evals.yaml` with common eval commands
- `environment.yaml` with environment settings
- `sandbox.yaml` with sandbox policies
- `index.json` files under `runs/`, `specs/`, and `reviews/`

Detects common agent binaries (`claude`, `codex`, `gemini`, etc.) on `$PATH` and pre-populates `agents.yaml`.

Interactive mode (TTY) prompts for confirmation. Non-TTY environments require the `--yes` flag.

### Examples

```bash
# Interactive mode (prompts for confirmation)
voratiq init

# Non-interactive mode (skip prompts)
voratiq init -y
```

### Errors

- Repository is not a git repo
- Insufficient permissions to create files

If `.voratiq/` already exists, `voratiq init` fills any missing files and directories.

## voratiq spec

Generate a structured spec from a task description via a (specific) sandboxed agent.

### Usage

```bash
voratiq spec --description <text> --agent <agent-id> [--title <text>] [--output <path>] [-y, --yes]
```

### Flags

| Flag                   | Required | Description                                                                |
| ---------------------- | -------- | -------------------------------------------------------------------------- |
| `--description <text>` | Yes      | Task description for the spec                                              |
| `--agent <agent-id>`   | Yes      | Agent to draft the spec (e.g., `claude-opus-4-5-20251101`)                 |
| `--title <text>`       | No       | Spec title; agent infers if omitted                                        |
| `--output <path>`      | No       | Output path; agent infers if omitted (default: `.voratiq/specs/<slug>.md`) |
| `-y, --yes`            | No       | Auto-accept first draft and skip confirmation (required in non-TTY shells) |

### Behavior

- TTY (interactive): drafts a spec, shows a preview, prompts `Save this specification? (Y/n):`, and loops on feedback until accepted
- Non-TTY: requires `--yes`; without it, exits with `Error: Non-interactive shell detected; re-run with --yes to accept defaults.`

### Examples

Interactive (TTY):

````
$ voratiq spec --description "add dark mode toggle with localStorage persistence" --agent claude-opus-4-5-20251101

Generating specification...

```markdown
# Add Dark Mode Toggle

## Summary
Implement a dark mode toggle in the settings page that persists
user preference to localStorage.

## Context
- Settings page: `src/components/Settings.tsx`
- No existing theme infrastructure

## Acceptance Criteria
- [ ] Toggle appears in settings page
- [ ] Preference persists in localStorage
- [ ] Theme applies on page load
```

Save this specification? (Y/n): n

What would you like to change?
> add system preference detection via prefers-color-scheme

Refining...

```markdown
# Add Dark Mode Toggle

## Summary
Implement a dark mode toggle in the settings page that respects
system preferences and persists user choice to localStorage.

## Context
- Settings page: `src/components/Settings.tsx`
- No existing theme infrastructure

## Acceptance Criteria
- [ ] Toggle appears in settings page
- [ ] Respects `prefers-color-scheme` on first visit
- [ ] User preference persists in localStorage and overrides system
- [ ] Theme applies on page load
```

Save this specification? (Y/n): y

Spec saved: .voratiq/specs/add-dark-mode-toggle.md

To begin a run:
  voratiq run --spec .voratiq/specs/add-dark-mode-toggle.md
````

### Errors

- Missing required flags
- Agent not found
- Output path already exists
- Specification generation failed

## `voratiq run`

Execute enabled agents against a Markdown spec.

### Usage

```bash
voratiq run --spec <path> [--max-parallel <count>]
```

### Options

- `--spec <path>`: Path to the Markdown spec file (required)
- `--max-parallel <count>`: Maximum number of agents to run concurrently (default: number of enabled agents)

### Behavior

1. Validates clean git tree, spec exists, agent/eval configs are valid
2. Generates run ID, creates run workspace, initializes run record
3. Spawns enabled agents in parallel, each in an isolated git worktree
4. Runs evals in each agent's workspace after the agent completes
5. Captures diffs, persists records, generates report

Exits with code 1 if:

- Preflight checks fail
- No agents are enabled
- Any agent fails or errors
- Any eval fails

Note: the run itself completes, but the exit code indicates failure.

### Examples

```bash
# Run all enabled agents against a spec
voratiq run --spec specs/fix-auth-bug.md

# Limit concurrency to 2 agents at a time
voratiq run --spec specs/refactor.md --max-parallel 2
```

### Errors

- Git working tree is not clean
- Spec file doesn't exist
- No agents are enabled
- Agent binary not found or not executable
- Stale or missing agent credentials
- Invalid agent/eval configuration

## `voratiq review`

Run a reviewer agent headlessly against a recorded run.

### Usage

```bash
voratiq review --run <run-id> --agent <agent-id>
```

### Options

- `--run <run-id>`: Run ID to review (required)
- `--agent <agent-id>`: Reviewer agent identifier (required)

### Behavior

Invokes the specified reviewer agent in headless mode. The agent reads run artifacts under `.voratiq/runs/sessions/<run-id>/` and writes its analysis to `.voratiq/reviews/sessions/<review-id>/<agent-id>/artifacts/review.md`. Execution is one-shot—there is no interactive accept/refine loop.

### Examples

```bash
voratiq review --run 20251031-232802-abc123 --agent gpt-5-2-codex
```

### Errors

- Run ID not found
- Run record is malformed
- Run artifacts are missing (warns but continues)

## `voratiq apply`

Apply a specific agent's diff to the repository using `git apply`.

### Usage

```bash
voratiq apply --run <run-id> --agent <agent-id> [--ignore-base-mismatch]
```

### Options

- `--run <run-id>`: Run ID containing the agent (required)
- `--agent <agent-id>`: Agent ID whose diff to apply (required)
- `--ignore-base-mismatch`: Skip base revision check (apply even if current HEAD differs from run's base)

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

Reads `.voratiq/runs/index.json` plus per-run `record.json` files in `.voratiq/runs/sessions/<run-id>/record.json` and renders a table with run ID, status, spec path, and creation timestamp.

### Examples

```bash
# List all runs (excluding pruned)
voratiq list

# List last 10 runs
voratiq list --limit 10

# List runs for a specific spec
voratiq list --spec specs/fix-auth-bug.md

# Show a specific run
voratiq list --run 20251031-232802-abc123

# Include pruned runs
voratiq list --include-pruned
```

### Errors

- `.voratiq/runs/index.json` or a per-run `record.json` is malformed

## `voratiq prune`

Remove run workspaces and mark the run as pruned in records (use `--purge` to delete artifacts).

### Usage

```bash
voratiq prune --run <run-id> [--purge] [-y, --yes]
```

### Options

- `--run <run-id>`: Run ID to prune (required)
- `--purge`: Delete all associated configs and artifacts
- `-y, --yes`: Skip interactive confirmations

### Behavior

1. Loads run record from `.voratiq/runs/sessions/<run-id>/record.json`
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
