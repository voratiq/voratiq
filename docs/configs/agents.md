---
title: Agent Configuration
---

# Agent Configuration

Register agents and their invocation details.

## Overview

`agents.yaml` is the local catalog of agents available to a repository. Voratiq never runs an agent that isn't in this file.

`voratiq init` populates this file with every supported agent and auto-detects installed CLIs to fill in binary paths. Your preset choice does not affect which agents appear here — it only shapes [orchestration](./orchestration.md). You can edit the catalog at any time.

## Schema

Top-level structure:

- `agents` (required) - array of agent entries.

Each agent entry:

- `id` (required) - unique identifier (max 64 chars); lowercase letters, digits, `_`, `-`.
- `provider` (required) - `claude`, `codex`, or `gemini`.
- `model` (required) - model identifier, e.g. `claude-opus-4-6`, `gpt-5.3-codex`, `gemini-2.5-pro`.
- `enabled` (optional, default `true`) - set `false` to disable.
- `binary` (optional) - absolute path to the provider CLI executable.
- `extraArgs` (optional) - additional CLI arguments; cannot include `--model` or `{{MODEL}}`.

## Example

```yaml
agents:
  - id: claude-opus-4-6
    provider: claude
    model: claude-opus-4-6
    binary: /usr/local/bin/claude

  - id: gpt-5-3-codex
    provider: codex
    model: gpt-5.3-codex
    binary: /usr/local/bin/codex

  - id: gemini-2-5-pro
    provider: gemini
    model: gemini-2.5-pro
    enabled: false
    binary: /usr/local/bin/gemini
```

Three providers, one agent each. The third is explicitly disabled.

## Validation

Agent ids must be unique across the catalog. `extraArgs` entries that contain forbidden model overrides (`--model`, `{{MODEL}}`) fail validation. Disabled agents remain in the file but cannot be referenced by orchestration.
