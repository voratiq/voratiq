---
title: CLI Reference
---

# CLI Reference

## Command Overview

| Command   | Use it for                                                                |
| --------- | ------------------------------------------------------------------------- |
| `voratiq` | Start an interactive agent session from a repo root                       |
| `spec`    | Draft a Markdown spec from a task description                             |
| `run`     | Execute agents against a spec                                             |
| `reduce`  | Synthesize recorded artifacts                                             |
| `verify`  | Evaluate recorded outputs from a spec, run, reduction, or message session |
| `message` | Collect persisted responses to a prompt                                   |
| `auto`    | Run the common coding workflow                                            |
| `apply`   | Apply a selected diff from a run                                          |
| `list`    | Inspect recorded sessions                                                 |
| `doctor`  | Diagnose and repair workspace or preflight setup                          |
| `mcp`     | Run the bundled Voratiq MCP server                                        |

## `voratiq`

Launch an interactive agent session.

### Usage

```bash
voratiq
```

### Behavior

- must be run from a git repo root
- creates `.voratiq/` on first use if it does not exist
- launches an interactive agent session with access to Voratiq operators
- may prompt for agent selection or tool attachment depending on your setup

See [Getting Started](getting-started.md) for a typical first launch.

## `voratiq spec`

Generate one or more specs from a task description.

### Usage

```bash
voratiq spec --description <text> [options]
```

### Options

- `--description <text>`: Task description (required)
- `--agent <agent-id>`: Set agents directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent agents
- `--title <text>`: Spec title; agent infers if omitted
- `--extra-context <path>`: Stage an extra context file into the spec workspace (repeatable)
- `--json`: Emit a machine-readable result envelope

### Behavior

Spec agents run in a sandbox and write Markdown specs under `.voratiq/spec/`. When more than one spec agent is configured or passed with repeated `--agent` flags, `spec` generates one draft per agent.

### Examples

```bash
voratiq spec --description "Add dark mode toggle with localStorage persistence"
```

## `voratiq run`

Execute agents against a spec.

### Usage

```bash
voratiq run --spec <path> [options]
```

### Options

- `--spec <path>`: Path to the spec file (required)
- `--agent <agent-id>`: Set agents directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent agents
- `--branch`: Create or checkout a branch named after the spec
- `--extra-context <path>`: Stage an extra context file into each agent workspace (repeatable)
- `--json`: Emit a machine-readable result envelope

### Behavior

`run`:

1. validates the repo and config state
2. creates a run session
3. spawns agents in isolated worktrees
4. captures diffs, summaries, logs, and metadata

Verification runs separately via `voratiq verify`.

### Examples

```bash
voratiq run --spec .voratiq/spec/fix-auth-bug.md
```

```bash
voratiq run --spec .voratiq/spec/refactor.md --branch
```

## `voratiq reduce`

Reduce recorded artifacts into a synthesized summary.

### Usage

```bash
voratiq reduce (--spec <spec-id> | --run <run-id> | --reduce <reduce-id> | --verify <verify-id> | --message <message-id>) [options]
```

### Options

- `--spec <spec-id>`: Spec to reduce
- `--run <run-id>`: Run to reduce
- `--reduce <reduce-id>`: Reduction to reduce
- `--verify <verify-id>`: Verification to reduce
- `--message <message-id>`: Message session to reduce
- `--agent <agent-id>`: Set reducers directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent reducers
- `--extra-context <path>`: Stage an extra context file into each reducer workspace (repeatable)
- `--json`: Emit a machine-readable result envelope

### Behavior

Reducers read staged artifacts and write `reduction.md` and `reduction.json`. Artifacts are saved under `.voratiq/reduce/`.

### Examples

```bash
voratiq reduce --run 20251031-232802-abc123
```

## `voratiq verify`

Verify recorded outputs from a spec, run, reduction, or message session.

### Usage

```bash
voratiq verify (--spec <spec-id> | --run <run-id> | --reduce <reduce-id> | --message <message-id>) [options]
```

### Options

- `--spec <spec-id>`: Spec to verify
- `--run <run-id>`: Run to verify
- `--reduce <reduce-id>`: Reduction to verify
- `--message <message-id>`: Message session to verify
- `--agent <agent-id>`: Set verifiers directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent verifiers
- `--extra-context <path>`: Stage an extra context file into each verifier workspace (repeatable)
- `--json`: Emit a machine-readable result envelope

### Behavior

Verification can include:

- programmatic checks
- rubric verifiers

Rubric verification is blinded when comparing candidates: verifiers see randomized candidate ids, not agent names. Artifacts are saved under `.voratiq/verify/`.

Verification produces a recommendation. It does not automatically apply a run diff unless a higher-level workflow does so.

Possible outcomes include:

- a clear recommendation with a concrete next action
- a recommendation without an automatic next action
- an unresolved outcome that still requires manual review

### Examples

```bash
voratiq verify --run 20251031-232802-abc123
```

```bash
voratiq verify --message 20251031-232802-abc123
```

Representative fields in a verification artifact:

```text
Recommendation
  Preferred Candidate: <candidate-id>
  Next Action:
    voratiq apply --run <run-id> --agent <agent-id>
```

When verification does not produce a clean next action, inspect the verification session with `voratiq list --verify <session-id>` and review the artifacts under `.voratiq/verify/`.

## `voratiq message`

Send the same prompt to one or more agents and persist their replies.

### Usage

```bash
voratiq message --prompt <text> [options]
```

### Options

- `--prompt <text>`: Prompt to send (required)
- `--agent <agent-id>`: Set recipient agents directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent recipients
- `--extra-context <path>`: Stage an extra context file into each recipient workspace (repeatable)
- `--json`: Emit a machine-readable result envelope

### Behavior

Recipients run independently against the same prompt. Replies are persisted under `.voratiq/message/`.

### Examples

```bash
voratiq message --prompt "Review this design doc for backlinks" --extra-context docs/backlinks-design.md
```

## `voratiq auto`

Run the common coding workflow in one command.

### Usage

```bash
voratiq auto (--spec <path> | --description <text>) [options]
```

### Options

Provide exactly one of `--spec` or `--description`.

- `--spec <path>`: Existing spec to run
- `--description <text>`: Generate a spec, then run and verify it
- `--run-agent <agent-id>`: Set run-stage agents directly (repeatable)
- `--verify-agent <agent-id>`: Set verify-stage agents directly (repeatable)
- `--profile <name>`: Orchestration profile (default: `default`)
- `--max-parallel <count>`: Max concurrent agents or verifiers
- `--branch`: Create or checkout a branch named after the spec
- `--apply`: Apply the selected diff after verification
- `--commit`: Commit after apply (requires `--apply`)

### Behavior

Stages run in order:

- `spec` if you passed `--description`
- `run`
- `verify`
- `apply` if you passed `--apply`

`reduce` is available separately when you want a synthesized step before verification.

### Examples

```bash
voratiq auto --description "Add backlinks between pages"
```

```bash
voratiq auto --description "Add backlinks between pages" --apply --commit
```

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
- `--json`: Emit a machine-readable result envelope

### Behavior

`apply` validates the repo state, loads the chosen diff from `.voratiq/run/`, checks the recorded base revision, and applies the patch to your working tree.

### Examples

```bash
voratiq apply --run 20251031-232802-abc123 --agent gpt-5-2-xhigh
```

## `voratiq list`

Inspect recorded sessions, or recover a recent `session-id`.

### Usage

```bash
voratiq list --<operator> [session-id] [options]
```

### Options

Pick one operator flag. Without an argument, it lists recent sessions for that operator. Pass a `session-id` to show one session in detail.

- `--spec [session-id]`: Spec sessions
- `--run [session-id]`: Run sessions
- `--reduce [session-id]`: Reduction sessions
- `--verify [session-id]`: Verification sessions
- `--message [session-id]`: Message sessions
- `--interactive [session-id]`: Interactive sessions
- `--limit <count>`: Show the N most recent sessions in the list view (default: `10`)
- `--all-statuses`: Include aborted sessions, which are hidden by default
- `--verbose`: Expand the detail view with per-agent sections and artifact paths
- `--json`: Emit machine-readable output

### Behavior

Without a `session-id`, `list` prints a compact table of recent sessions with status, target, and timing. Aborted sessions are hidden unless you pass `--all-statuses`. Use `--limit` to change how many rows you see.

With a `session-id`, `list` prints that session's metadata and a per-agent status table. It is compact by default; `--verbose` expands it with per-agent sections and artifact paths.

`--json` emits the same list or detail view as machine-readable output.

### Examples

```bash
voratiq list --run
```

```bash
voratiq list --run --all-statuses
```

```bash
voratiq list --verify 20251031-232802-abc123
```

```bash
voratiq list --run 20251031-232802-abc123 --verbose
```

## `voratiq doctor`

Diagnose workspace and preflight setup issues.

### Usage

```bash
voratiq doctor [options]
```

### Options

- `--fix`: Apply safe workspace and managed-config repairs

### Behavior

Without `--fix`, `doctor` reports workspace structure, config, environment, and agent-readiness issues.

With `--fix`, `doctor`:

- bootstraps `.voratiq/` when the workspace is missing
- repairs missing workspace files and directories when the workspace exists
- reconciles managed config such as `agents.yaml`, `environment.yaml`, `orchestration.yaml`, and `managed-state.json`
- preserves customized orchestration config when it no longer looks managed
- may prompt for a bootstrap preset in an interactive shell; otherwise it defaults to `pro`

Bootstrapping or repair ensures the config surface and operator directories under `.voratiq/`, including `spec/`, `run/`, `reduce/`, `verify/`, `message/`, and `interactive/`.

### Examples

```bash
voratiq doctor
```

```bash
voratiq doctor --fix
```

## `voratiq mcp`

Run the bundled Voratiq MCP server.

### Usage

```bash
voratiq mcp --stdio
```

### Options

- `--stdio`: Serve MCP over stdio (required)
