---
title: CLI Reference
---

# CLI Reference

Complete reference for all Voratiq commands.

## Global Behavior

- Must be run inside a git repository
- `.voratiq/` is created automatically on first use
- Transcripts stream to stdout; stderr is reserved for warnings and errors
- Commands exit with code 1 on operational errors

## `voratiq auto`

Run `spec`, `run`, `verify`, and `apply` as one command.

### Usage

```bash
voratiq auto (--spec <path> | --description <text>) [options]
```

### Options

Provide exactly one of `--spec` or `--description`.

- `--spec <path>`: Existing spec to run
- `--description <text>`: Generate a spec, then run and verify it
- `--run-agent <agent-id>`: Set run-stage agents directly (repeatable; order preserved)
- `--verify-agent <agent-id>`: Set verify-stage agents directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent agents/verifiers
- `--branch`: Create or checkout a branch named after the spec
- `--apply`: Apply the selected candidate after verification
- `--commit`: Commit after apply (requires `--apply`)

### Behavior

Stages run in order: `spec` (if `--description`), `run`, `verify`, `apply` (if `--apply`).

### Examples

```bash
# Apply and commit the winner
voratiq auto --description "add retries to billing webhook delivery" --apply --commit
```

### Errors

- Exactly one of `--spec` or `--description` is required
- `--commit` requires `--apply`
- Stage failure in `spec`, `run`, `verify`, or `apply`
- Verifiers disagree and no single candidate resolves

## `voratiq init`

Initialize the Voratiq workspace.

### Usage

```bash
voratiq init [options]
```

### Options

- `--preset <preset>`: Select a preset (`pro|lite|manual`, default: `pro`)
- `-y, --yes`: Assume yes and accept defaults (suppresses prompts; useful for CI/scripts)

### Behavior

Creates:

- `.voratiq/` directory
- `spec/`, `run/`, `verify/`, and `reduce/` directories
- `agents.yaml` with the full supported agent catalog (binary paths filled for CLIs found on `$PATH`)
- `orchestration.yaml` with stage-to-agent assignments based on the selected preset
- `environment.yaml` with environment settings
- `verification.yaml` with verification settings
- `sandbox.yaml` with sandbox policies
- `index.json` files under `spec/`, `run/`, `verify/`, and `reduce/`

If `.voratiq/` already exists, `voratiq init` fills any missing files and directories.

Interactive mode (TTY) prompts for confirmation. Non-TTY environments require the `--yes` flag.

### Examples

```bash
voratiq init
```

```bash
# Smaller, faster agent set
voratiq init --preset lite
```

### Errors

- Repository is not a git repo
- Insufficient permissions to create files

## `voratiq spec`

Generate a spec from a task description.

### Usage

```bash
voratiq spec --description <text> [options]
```

### Options

- `--description <text>`: Task description (required)
- `--agent <agent-id>`: Agent to draft the spec (uses orchestration config if omitted)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--title <text>`: Spec title; agent infers if omitted
- `--output <path>`: Output path (default: `.voratiq/spec/<slug>.md`)

### Behavior

The spec agent runs in a sandbox.

### Examples

```bash
# Spec agent comes from orchestration.yaml
voratiq spec --description "add dark mode toggle with localStorage persistence"
```

```bash
# Set the spec agent directly
voratiq spec --description "add dark mode toggle with localStorage persistence" --agent claude-opus-4-5-20251101
```

### Errors

- Missing required flags
- Agent not found
- No agent found for spec stage (stage config empty and no `--agent`)
- Multiple agents found for spec stage (multi-agent spec is not supported)
- Output path already exists
- Spec generation failed

## `voratiq run`

Execute agents against a spec.

### Usage

```bash
voratiq run --spec <path> [options]
```

### Options

- `--spec <path>`: Path to the spec file (required)
- `--agent <agent-id>`: Set agents directly (repeatable; order preserved)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent agents (default: all)
- `--branch`: Create or checkout a branch named after the spec

### Behavior

1. Validates clean git tree, spec exists, and configs are valid
2. Generates run ID, creates run workspace, initializes run record
3. Spawns agents, each in an isolated git worktree
4. Captures diffs, persists records, generates report

Verification (programmatic checks + rubric verifiers) runs separately via `voratiq verify`.

### Examples

```bash
voratiq run --spec .voratiq/spec/fix-auth-bug.md
```

```bash
# Isolate changes on a branch
voratiq run --spec .voratiq/spec/refactor.md --branch
```

### Errors

- Git working tree is not clean
- Spec file doesn't exist
- No agents found for the stage (empty orchestration config and no `--agent` override)
- Agent binary not found or not executable
- Stale or missing agent credentials
- Invalid agent or verification configuration

## `voratiq reduce`

Reduce artifact sets into a summarized form.

### Usage

```bash
voratiq reduce (--spec <spec-id> | --run <run-id> | --verify <verify-id> | --reduce <reduce-id>) [options]
```

### Options

- `--spec <spec-id>`: Spec to reduce
- `--run <run-id>`: Run to reduce
- `--verify <verify-id>`: Verification to reduce
- `--reduce <reduce-id>`: Reduction to reduce
- `--agent <agent-id>`: Set reducers directly (repeatable; order preserved)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent reducers (default: all)
- `--extra-context <path>`: Stage an extra context file into each reducer workspace (repeatable)

### Behavior

Reducers read staged artifacts and write `reduction.md` and `reduction.json`. Artifacts are saved under `.voratiq/reduce/`.

### Examples

```bash
voratiq reduce --run 20251031-232802-abc123
```

## `voratiq verify`

Verify a recorded spec, run, reduce, or message session.

### Usage

```bash
voratiq verify (--spec <spec-id> | --run <run-id> | --reduce <reduce-id> | --message <message-id>) [options]
```

### Options

- `--spec <spec-id>`: Spec to verify
- `--run <run-id>`: Run to verify
- `--reduce <reduce-id>`: Reduction to verify
- `--message <message-id>`: Message session to verify
- `--agent <agent-id>`: Set verifiers directly (repeatable; order preserved)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent verifiers (default: all)
- `--extra-context <path>`: Stage an extra context file into each verifier workspace (repeatable)

### Behavior

Verification is blinded when comparing candidates — verifiers see randomized candidate ids, not agent names. Artifacts are saved under `.voratiq/verify/`.

### Examples

```bash
voratiq verify --run 20251031-232802-abc123
```

```bash
voratiq verify --message 20251031-232802-abc123
```

```bash
# Set verifiers directly
voratiq verify --run 20251031-232802-abc123 --agent gpt-5-2-codex --agent claude-opus-4-5-20251101
```

### Errors

- Target ID not found
- Target record is malformed
- No agent found for verify stage (stage config empty and no `--agent`)
- Verifier authentication fails (aborts before any verifier starts)
- Verifier output contract violation
- Target artifacts are missing

## `voratiq apply`

Apply an agent's diff from a run.

### Usage

```bash
voratiq apply --run <run-id> --agent <agent-id> [options]
```

### Options

- `--run <run-id>`: Run ID containing the agent (required)
- `--agent <agent-id>`: Agent ID whose diff to apply (required)
- `--ignore-base-mismatch`: Skip base revision check
- `--commit`: Commit after apply, using the agent's summary as the message

### Behavior

1. Validates git working tree is clean
2. Loads the agent's diff from `.voratiq/run/`
3. Verifies `HEAD` matches the run's base revision
4. Executes `git apply <diff.patch>`

### Examples

```bash
voratiq apply --run 20251031-232802-abc123 --agent gpt-5-2-xhigh
```

```bash
# Apply and commit
voratiq apply --run 20251031-232802-abc123 --agent gpt-5-2-xhigh --commit
```

### Errors

- Run or agent not found
- Git working tree is not clean
- Base revision mismatch (without `--ignore-base-mismatch`)
- `git apply` fails (conflicts or other errors)

## `voratiq list`

List recorded runs.

### Usage

```bash
voratiq list [options]
```

### Options

- `--limit <count>`: Show only the N most recent runs (default: 10)
- `--spec <path>`: Filter by spec path
- `--run <run-id>`: Show only the specified run ID
- `--include-pruned`: Include runs marked as pruned

### Behavior

Shows run ID, status, spec path, and creation timestamp.

### Examples

```bash
voratiq list
```

```bash
# Filter by spec
voratiq list --spec .voratiq/spec/fix-auth-bug.md
```

### Errors

- Run records are malformed

## `voratiq prune`

Remove run workspaces and mark runs as pruned.

### Usage

```bash
voratiq prune (--run <run-id> | --all) [options]
```

### Options

- `--run <run-id>`: Run ID to prune (required)
- `--all`: Prune all non-pruned runs
- `--purge`: Delete all associated configs and artifacts
- `-y, --yes`: Skip interactive confirmations

### Behavior

1. Loads the run record
2. Shows what will be deleted, then confirms (unless `-y`)
3. Deletes run worktrees and, when `--purge` is set, all associated configs and artifacts
4. Updates run record, marking it as pruned

`--purge` still prompts for confirmation; combine with `-y` to skip.

### Examples

```bash
voratiq prune --run 20251031-232802-abc123
```

```bash
# Full cleanup, no prompts
voratiq prune --run 20251031-232802-abc123 --purge -y
```

### Errors

- Run ID not found
- Artifacts already deleted
- Insufficient permissions to delete files
