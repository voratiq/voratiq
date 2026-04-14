---
title: Orchestration Configuration
---

# Orchestration Configuration

Control which agents run at each stage.

## Overview

Voratiq uses agents across swarm workflows: drafting specifications (`spec`), executing tasks (`run`), reducing completed sessions (`reduce`), verifying results (`verify`), and sending isolated prompts (`message`). Orchestration profiles determine which agents from the [agent catalog](./agents.md) participate at each stage, so the same runtime can support different workflow architectures. Workspace bootstrap seeds `profiles.default` based on the preset you choose, and `voratiq doctor --fix` reconciles that managed default when appropriate.

## Schema

Top-level structure:

- `profiles` (required) - map of named profiles.
- `profiles.default` (required) - used when `--profile` is omitted.

Profile name rules:

- lowercase letters, digits, and `-`; must start with a letter or digit
- max length: `64`
- must be unique within `profiles`

Each profile supports five stage blocks: `spec`, `run`, `reduce`, `verify`, and `message`. Each stage block has:

- `agents` (required) - array of agent references.
- `agents[].id` (required) - an agent id from `agents.yaml`.

All five stages accept multiple agents. `message` may be omitted; it defaults to an empty agent list.

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
    reduce:
      agents:
        - id: gpt-5-3-codex-high
    verify:
      agents:
        - id: gpt-5-3-codex-high
    message:
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
    reduce:
      agents:
        - id: gpt-5-3-codex-high
    verify:
      agents:
        - id: gpt-5-3-codex-high
    message:
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
    reduce:
      agents:
        - id: gpt-5-1-codex-mini
    verify:
      agents:
        - id: gpt-5-1-codex-mini
    message:
      agents:
        - id: gpt-5-1-codex-mini
```

Profiles let you switch agent sets without editing stage lists.

## Usage

Without `--profile`, Voratiq uses `profiles.default`:

```bash
voratiq run --spec .voratiq/spec/task.md
```

With `--profile`, Voratiq uses the named profile:

```bash
voratiq run --spec .voratiq/spec/task.md --profile expanded
```

## Validation

Unknown top-level keys, invalid profile names, missing `profiles.default`, missing required stage blocks (`spec`, `run`, `reduce`, `verify`), unknown stage keys, and duplicate agent ids within a stage all fail. Agent ids must reference enabled entries in `agents.yaml`.
