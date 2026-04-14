---
title: Getting Started
---

# Getting Started

Run workflows, delegate to swarms, and verify outputs before you apply them.

This guide gets you from first launch to a working flow, then shows which workflow to use next.

## Before You Start

You need:

- a git repository
- Voratiq installed (`npm install -g voratiq`)
- at least one authenticated provider CLI on your `PATH`

Voratiq records session state under `.voratiq/`. Most repos should add that path to `.gitignore`.

Most workflow and interactive entry commands bootstrap `.voratiq/` automatically on first use. If setup looks stale or broken later, use `voratiq doctor` to inspect it and `voratiq doctor --fix` to repair it.

## Operational Assumptions

- coding flows are safest with a clean working tree (`run`, `verify --run`, `apply`, and `auto`)
- some coding flows work best once the repo has at least one commit
- review and coding flows both require an authenticated provider CLI on your `PATH`

## Choose A Workflow

| Goal                                         | Start with                       |
| -------------------------------------------- | -------------------------------- |
| Explore a task conversationally              | `voratiq` (interactive)          |
| Get multiple agent perspectives on something | `message -> verify`              |
| Run an end-to-end coding workflow            | `auto`                           |
| Run the coding workflow with explicit stages | `spec -> run -> verify -> apply` |

## Interactive Entry

```bash
voratiq
```

This is REPL-like: it launches a native agent session with access to Voratiq's operators. The agent can call `spec`, `run`, `reduce`, `verify`, or `message` as the task unfolds.

Use this when you're exploring or want the agent to decide what workflow fits.

## Multi-Agent Review: `message -> verify`

Use `message` when you want several agents to respond to the same prompt independently. Each response is persisted as a separate artifact.

```bash
voratiq message \
  --prompt "Review this design doc for backlinks. Flag any issues with the proposed approach."
```

Then `verify` can recommend a response to use, indicate that one needs deeper inspection, or leave the next step to manual judgment.

```bash
voratiq verify --message <session-id>
```

You now have multiple responses and a verification result that can recommend one to use or indicate that you still need manual review.

Use `reduce` to synthesize the responses into one shared artifact before or instead of verification:

```bash
voratiq reduce --message <session-id>
```

## End-to-End Coding: `auto`

`auto` runs the most common coding workflow in one command: spec, run, verify.

```bash
voratiq auto --description "Add backlinks between pages"
```

Add `--apply` to apply the selected diff, or `--apply --commit` to also commit it.

For more control, run the stages separately:

```bash
voratiq spec --description "Add backlinks between pages"
voratiq run --spec .voratiq/spec/add-backlinks-between-pages.md
voratiq verify --run <run-id>
voratiq apply --run <run-id> --agent <agent-id>
```

Use `reduce` when you want to synthesize several run artifacts into one:

```bash
voratiq reduce --run <run-id>
voratiq verify --run <run-id>
```

## Multi-Stage Workflows

Operators compose. A workflow can chain several decision points:

```text
message -> reduce -> verify -> spec -> run -> verify -> apply
```

For example: gather analysis with `message`, synthesize with `reduce`, use `verify` to decide whether the result is ready to use or needs more review, then turn it into a spec, generate implementations with `run`, verify again, and apply.

## Polling Long-Running Sessions

Many operators take several minutes to complete. Some take hours.

Use `list` to poll operator sessions and see the status of each agent involved:

```bash
voratiq list --spec
voratiq list --run
voratiq list --reduce
voratiq list --verify
voratiq list --message
```

Interactive sessions are also inspectable:

```bash
voratiq list --interactive
```

To inspect a specific session:

```bash
voratiq list --run <session-id>
```

Session IDs appear in operator output.
