---
title: Agent Configuration
---

# Agent Configuration

Defines which AI coding agents Voratiq runs and how each process is invoked.

## Overview

Voratiq reads `.voratiq/agents.yaml` to determine which AI coding agents to spawn and how to invoke them. `voratiq init` scaffolds this file, detects known agent binaries, and seeds each provider with its flagship model. Update it at any time.

## Schema

Top-level structure:

- `agents` (required) – array of agent entries evaluated top to bottom.

Each agent entry supports:

- `id` (required) – unique identifier per entry (max 32 characters); use lowercase letters, digits, hyphens, or underscores.
- `provider` (required) – agent type. Supported values: `claude`, `codex`, `gemini`.
- `model` (required) – provider-specific model slug, e.g. `claude-sonnet-4-5-20250929`, `gpt-5.1-codex-max`, `gemini-2.5-pro`.
- `enabled` (optional, default `true`) – set to `false` to keep a definition without executing it.
- `binary` (optional, default empty string) – absolute path to the agent executable.
- `extraArgs` (optional) – array of additional agent CLI arguments.

## `agents.yaml` Examples

### Run Each Provider's Flagship Model

```yaml
agents:
  - id: claude-sonnet-4-5-20250929
    provider: claude
    model: claude-sonnet-4-5-20250929
    enabled: true
    binary: /usr/local/bin/claude

  - id: gpt-5-1-codex-max
    provider: codex
    model: gpt-5.1-codex-max
    enabled: true
    binary: ~/.local/bin/codex

  - id: gemini-3-pro-preview
    provider: gemini
    model: gemini-3-pro-preview
    enabled: true
    binary: /usr/local/bin/gemini
```

Cross-provider comparison on the same spec.

### Cheaper Models for CI

```yaml
agents:
  - id: claude-haiku-4-5-20251001
    provider: claude
    model: claude-haiku-4-5-20251001
    enabled: true
    binary: /usr/local/bin/claude

  - id: gpt-5-1-codex-mini
    provider: codex
    model: gpt-5.1-codex-mini
    enabled: true
    binary: ~/.local/bin/codex

  - id: gemini-2-5-flash
    provider: gemini
    model: gemini-2.5-flash
    enabled: true
    binary: /usr/local/bin/gemini
```

Fast, low-cost validation before expensive runs.

### Customize with Extra Arguments

```yaml
agents:
  - id: gpt-5-1-codex
    provider: codex
    model: gpt-5.1-codex
    enabled: true
    binary: ~/.local/bin/codex

  - id: gpt-5-1-codex-high
    provider: codex
    model: gpt-5.1-codex
    enabled: true
    binary: ~/.local/bin/codex
    extraArgs:
      - "--config"
      - "model_reasoning_effort=high"
```

Optimize quality vs cost tradeoffs on the same model.

### Compare Model Releases

**Codex:**

```yaml
agents:
  - id: gpt-5-codex
    provider: codex
    model: gpt-5-codex
    enabled: true
    binary: ~/.local/bin/codex

  - id: gpt-5-1-codex
    provider: codex
    model: gpt-5.1-codex
    enabled: true
    binary: ~/.local/bin/codex
```

**Gemini:**

```yaml
agents:
  - id: gemini-2-5-pro
    provider: gemini
    model: gemini-2.5-pro
    enabled: true
    binary: /usr/local/bin/gemini

  - id: gemini-3-pro-preview
    provider: gemini
    model: gemini-3-pro-preview
    enabled: true
    binary: /usr/local/bin/gemini
```

See if a new release is worth migrating to.
