---
title: Agent Configuration
---

# Agent Configuration

Register agents and their invocation details.

## Overview

`agents.yaml` is the local catalog of agents available to a repository. Voratiq never runs an agent that isn't in this file.

Voratiq seeds this file when it bootstraps `.voratiq/` on first use or via `voratiq doctor --fix`. It populates every supported agent and auto-detects installed CLIs to fill in binary paths. Your preset choice does not affect which agents appear here; it only shapes [orchestration](./orchestration.md). You can edit the catalog at any time.

## Schema

Top-level structure:

- `agents` (required) - array of agent entries.

Each agent entry:

- `id` (required) - unique identifier (max 64 chars); lowercase letters, digits, `_`, `-`.
- `provider` (required) - `claude`, `codex`, or `gemini`.
- `model` (required) - model identifier, e.g. `claude-opus-4-7`, `gpt-5.4`, `gemini-3.1-pro-preview`.
- `enabled` (optional, default `true`) - set `false` to disable.
- `binary` (optional) - absolute path to the provider CLI executable.
- `extraArgs` (optional) - additional CLI arguments; cannot include `--model` or `{{MODEL}}`.

## Example

```yaml
agents:
  - id: claude-opus-4-7-xhigh
    provider: claude
    model: claude-opus-4-7
    binary: /usr/local/bin/claude
    extraArgs:
      - --effort
      - xhigh

  - id: gpt-5-4-high
    provider: codex
    model: gpt-5.4
    binary: /usr/local/bin/codex
    extraArgs:
      - --config
      - model_reasoning_effort=high

  - id: gemini-3-1-pro-preview
    provider: gemini
    model: gemini-3.1-pro-preview
    enabled: false
    binary: /usr/local/bin/gemini
```

Three providers, one agent each. The third is explicitly disabled.

## Validation

Agent ids must be unique across the catalog. `extraArgs` entries that contain forbidden model overrides (`--model`, `{{MODEL}}`) fail validation. Disabled agents remain in the file but cannot be referenced by orchestration.
