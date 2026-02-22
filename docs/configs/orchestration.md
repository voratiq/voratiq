---
title: Orchestration Configuration
---

# Orchestration Configuration

Control which agents run at each stage.

## Overview

Voratiq uses agents to draft specifications (`spec`), execute tasks (`run`), and analyze results (`review`). Orchestration profiles determine which agents from the [agent catalog](./agents.md) participate in each. `voratiq init` seeds `profiles.default` based on the preset you choose.

## Schema

Top-level structure:

- `profiles` (required) - map of named profiles.
- `profiles.default` (required) - used when `--profile` is omitted.

Profile name rules:

- lowercase letters, digits, and `-`; must start with a letter or digit
- max length: `64`
- must be unique within `profiles`

Each profile has three stage blocks: `spec`, `run`, and `review`. Each stage block has:

- `agents` (required) - array of agent references.
- `agents[].id` (required) - an agent id from `agents.yaml`.

`spec` requires exactly one agent at runtime unless overridden with `--agent`. `run` and `review` accept multiple agents.

## Example

```yaml
profiles:
  default:
    spec:
      agents:
        - id: claude-opus-4-6
    run:
      agents:
        - id: claude-opus-4-6
        - id: gpt-5-3-codex-high
        - id: gemini-2-5-pro
    review:
      agents:
        - id: gpt-5-3-codex-high

  expanded:
    spec:
      agents:
        - id: claude-opus-4-6
    run:
      agents:
        - id: claude-opus-4-5-20251101
        - id: claude-opus-4-6
        - id: gpt-5-2-high
        - id: gpt-5-3-codex-high
        - id: gpt-5-3-codex-xhigh
        - id: gemini-2-5-pro
        - id: gemini-3-pro-preview
    review:
      agents:
        - id: gpt-5-3-codex-high

  test:
    spec:
      agents:
        - id: claude-haiku-4-5-20251001
    run:
      agents:
        - id: claude-haiku-4-5-20251001
        - id: gpt-5-1-codex-mini
    review:
      agents:
        - id: gpt-5-1-codex-mini
```

Add profiles to switch between different agent sets without editing stage lists each time.

## Usage

Without `--profile`, Voratiq uses `profiles.default`:

```bash
voratiq run --spec .voratiq/specs/task.md
```

With `--profile`, Voratiq uses the named profile:

```bash
voratiq run --spec .voratiq/specs/task.md --profile expanded
```

## Validation

Unknown top-level keys, invalid profile names, missing `profiles.default`, unknown stage keys, and duplicate agent ids within a stage all fail. Agent ids must reference enabled entries in `agents.yaml`.
