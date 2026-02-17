---
title: Agent Configuration
---

# Agent Configuration

Register agents and their invocation details.

## Overview

`agents.yaml` is the local catalog of agents available to a repository. Each entry defines a stable id, a provider and model, and enough to invoke the agent (binary path, optional CLI args). Voratiq never runs an agent that isn't in this file.

`voratiq init` seeds the catalog from a preset (pro, lite, or manual) by detecting supported CLIs on `$PATH`. You can edit it at any time.

This file defines what exists. Which agents run at which stage is determined by [orchestration configuration](./orchestration.md), which references agent ids from this catalog and requires them to be enabled.

## Schema

Top-level structure:

- `agents` (required) - array of agent entries.

Each agent entry:

- `id` (required) - unique identifier (max 32 chars); lowercase letters, digits, `_`, `-`.
- `provider` (required) - `claude`, `codex`, or `gemini`.
- `model` (required) - provider model slug, e.g. `claude-opus-4-6`, `gpt-5.3-codex`, `gemini-2.5-pro`.
- `enabled` (optional, default `true`) - set `false` to keep the entry in the catalog without making it available to orchestration.
- `binary` (optional) - absolute path to the provider CLI executable.
- `extraArgs` (optional) - additional CLI arguments; cannot include `--model` or `{{MODEL}}`.

## Example

```yaml
agents:
  - id: claude-opus-4-6
    provider: claude
    model: claude-opus-4-6
    enabled: true
    binary: /usr/local/bin/claude

  - id: gpt-5-3-codex
    provider: codex
    model: gpt-5.3-codex
    enabled: true
    binary: /usr/local/bin/codex

  - id: gemini-2-5-pro
    provider: gemini
    model: gemini-2.5-pro
    enabled: true
    binary: /usr/local/bin/gemini
```

Three providers, one agent each. Orchestration decides which of these run at each stage.

## Validation

Agent ids must be unique across the catalog. `extraArgs` entries that contain forbidden model overrides (`--model`, `{{MODEL}}`) fail validation. Disabled agents remain in the file but cannot be referenced by orchestration.
