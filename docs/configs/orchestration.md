---
title: Orchestration Configuration
---

# Orchestration Configuration

Control which agents run at each stage.

## Overview

Voratiq has three stages: `run`, `review`, and `spec`. Orchestration determines which agents from the [agent catalog](./agents.md) participate in each. Without this file, there's no implicit fallback: the config must exist and pass validation, or the command fails.

Validation is strict. Unknown keys, malformed entries, and agent references that don't match an enabled entry in `.voratiq/agents.yaml` all fail immediately with an error that includes the path to the problem.

## Schema

Top-level structure:

- `profiles` (required) - profile map. Only `profiles.default` is supported in this phase.

Each profile requires three stage blocks: `run`, `review`, and `spec`. Each stage block requires:

- `agents` (required) - array of agent references (may be empty in schema, but `spec` and `review` require exactly one resolved agent at runtime unless overridden with `--agent`).
- `agents[].id` (required) - an agent id from `.voratiq/agents.yaml` that is enabled.

## Example

```yaml
profiles:
  default:
    spec:
      agents: []

    run:
      agents:
        - id: claude-opus-4-6
        - id: gpt-5-3-codex

    review:
      agents: []
```

This is the default seeded policy from `voratiq init`: `run` includes all enabled agents in `agents.yaml` order, while `spec` and `review` start empty. The agent ids must appear in `agents.yaml` and be enabled there.

## Validation

Unknown top-level keys, unknown profile keys (only `default` is valid), unknown stage keys, and duplicate agent ids within a stage all fail. Any agent id that doesn't exist in `agents.yaml` or is disabled there also fails.
