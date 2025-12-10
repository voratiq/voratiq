---
title: Sandbox Configuration
---

# Sandbox Configuration

Customize network and filesystem policies enforced during agent execution.

## Overview

Voratiq reads `.voratiq/sandbox.yaml` to override default sandbox policies per provider (`claude`, `codex`, `gemini`). `voratiq init` generates this file with empty provider stubs. Add overrides only when you need to relax or tighten restrictions. Providers omitted from the file inherit built-in defaults.

## Schema

Top-level structure:

- `providers` (required) – maps provider IDs to override blocks.

Each provider entry supports:

- **Network overrides** (top-level or nested under `network`):
  - `allowedDomains` (optional) – array of domains the agent may reach via HTTPS. Merges with built-in defaults.
  - `deniedDomains` (optional) – array of domains to block. Appends to the default deny list.
  - `allowLocalBinding` (optional, default `false`) – set `true` to permit binding to local network interfaces.
  - `allowUnixSockets` (optional) – array of Unix socket paths the agent may connect to.
  - `allowAllUnixSockets` (optional, default `false`) – set `true` to disable Unix socket isolation entirely. Voratiq emits a warning when this is enabled.

- **Filesystem overrides** (nested under `filesystem`):
  - `allowWrite` (optional) – array of paths where the agent may write files. Merges with workspace and sandbox home directories (which are always writable).
  - `denyRead` (optional) – array of paths to block from reads.
  - `denyWrite` (optional) – array of paths to block from writes.

## `sandbox.yaml` Examples

### Allow Extra Network Domains

```yaml
providers:
  claude:
    allowedDomains:
      - cdn.example.com
      - storage.googleapis.com

  codex: {}
  gemini: {}
```

Extends Claude's allowed domains while leaving Codex and Gemini at their defaults.

### Deny Sensitive Directories

```yaml
providers:
  claude:
    filesystem:
      denyRead:
        - .env
        - secrets/

  codex: {}
  gemini: {}
```

Prevent all agents from reading environment files and a secrets directory.

### Top-Level Network Overrides

```yaml
providers:
  claude:
    allowedDomains:
      - example.com
    allowLocalBinding: true

  codex: {}
  gemini: {}
```

Network overrides may appear at the provider top level for convenience. This is equivalent to nesting them under a `network` key.

### Nested Network and Filesystem

```yaml
providers:
  claude:
    network:
      allowedDomains:
        - custom-api.example.com
      deniedDomains:
        - blocked.local
    filesystem:
      allowWrite:
        - /tmp/agent-cache
      denyWrite:
        - dist/

  codex: {}
  gemini: {}
```

Combine network and filesystem overrides for granular control.

### Unix Socket Access

```yaml
providers:
  claude:
    allowUnixSockets:
      - /var/run/docker.sock

  codex: {}
  gemini: {}
```

Grant Claude access to a specific Unix socket while maintaining isolation for other agents.

### Git Cloning and NPM Package Installation

```yaml
providers:
  claude:
    allowedDomains:
      - github.com
      - registry.npmjs.org

  codex: {}
  gemini: {}
```

Lets agents clone public repositories and install packages directly. Agents can pull in dependencies, reference example code, or scaffold new projects without manual intervention.

**Security risks:** Package install scripts execute arbitrary code without review. Malicious packages or repositories can exfiltrate data, inject backdoors, or compromise your workspace. Safer alternatives: pre-populate dependencies locally (see [Environment Configuration](https://github.com/voratiq/voratiq/blob/main/docs/configs/environment.md)), use private registries, or constrain specs to audited dependencies only.
